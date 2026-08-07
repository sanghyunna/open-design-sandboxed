import { fork, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SmokeSuite } from './smoke-suite.ts';
import {
  allocateToolsDevRuntime,
  isToolsDevPortConflict,
  readToolsDevLogs,
  startToolsDevWeb,
  stopToolsDevDaemon,
  stopToolsDevWeb,
  type ToolsDevStopResult,
  type ToolsDevRuntime,
} from './tools-dev.ts';

export type HostedIdentity = 'a' | 'b';
export type HostedRestartKind = 'graceful' | 'crash';

export type HostedHttpClient = {
  readonly headers: Readonly<{ authorization: string }>;
  request(path: string, init?: RequestInit): Promise<Response>;
  json<T>(path: string, init?: RequestInit): Promise<T>;
};

export type HostedProviderRequestSummary = {
  readonly count: number;
  readonly maxConcurrentMarkedRequests: number;
  readonly maxConcurrentMarkedRequestsByCredential: Readonly<Record<HostedIdentity, number>>;
  readonly requests: ReadonlyArray<{
    readonly credential: HostedIdentity | 'unknown';
    readonly method: string;
    readonly model: string | null;
    readonly path: string;
    readonly promptMarker: HostedIdentity | 'mixed' | 'unknown';
    readonly stream: boolean | null;
  }>;
};

export type HostedSuiteContext = {
  readonly daemonUrl: string;
  readonly webUrl: string;
  readonly runtimeRoot: string;
  identity(identity: HostedIdentity): HostedHttpClient;
  restart(kind: HostedRestartKind): Promise<void>;
  readonly provider: {
    credential(identity: HostedIdentity): string;
    requestSummary(): HostedProviderRequestSummary;
  };
};

type ProviderRequest = HostedProviderRequestSummary['requests'][number];
type ProviderFixture = {
  close(): Promise<void>;
  readonly origin: string;
  requestSummary(): HostedProviderRequestSummary;
};

const READY_TIMEOUT_MS = 30_000;
const PROVIDER_CREDENTIALS = Object.freeze({
  a: 'hosted-e2e-provider-a',
  b: 'hosted-e2e-provider-b',
});

export async function runHostedSuite(
  suite: SmokeSuite,
  run: (context: HostedSuiteContext) => Promise<void>,
): Promise<string> {
  let runtime = await allocateToolsDevRuntime();
  let provider: ProviderFixture | null = null;
  let child: ChildProcess | null = null;
  let initialDaemonPid: number | null = null;
  let initialWebPid: number | null = null;
  let childGeneration = 0;
  let success = false;
  let caughtError: unknown = null;
  let diagnostics: unknown = null;
  const childOutput: Array<{ generation: number; stream: 'stderr' | 'stdout'; text: string }> = [];
  const suiteHash = createHash('sha256').update(suite.namespace).digest('hex').slice(0, 8);
  const workspaceRoot = resolve(suite.root, '..', '..', '..');
  const toolsRoot = join(workspaceRoot, '.tmp', 'h', suiteHash);
  const toolsSuite = {
    ...suite,
    namespace: `eh-${suiteHash}`,
    toolsDevRoot: toolsRoot,
  };
  // Keep the fixed hosted storage suffixes below Windows' legacy path ceiling.
  const runtimeRoot = join(process.env.RUNNER_TEMP ?? tmpdir(), 'od-h', suiteHash);
  const fixturePath = fileURLToPath(import.meta.resolve(
    '@open-design/daemon/testing/hosted-acceptance-server',
  ));
  let webUrl = '';
  let daemonUrl = '';
  let configPath = '';
  const clients = new Map<HostedIdentity, HostedHttpClient>();

  const envFor = (candidate: ToolsDevRuntime): Record<string, string> => ({
    OD_HOSTED_PUBLIC_ORIGIN: `http://127.0.0.1:${candidate.webPort}`,
    OD_WEB_COMPOSITION: 'hosted',
  });

  const stopChild = async (kind: HostedRestartKind): Promise<void> => {
    const target = child;
    child = null;
    if (target == null || target.exitCode != null || target.signalCode != null) return;
    if (kind === 'graceful' && target.connected) target.send({ type: 'shutdown' });
    else if (kind === 'crash') await killProcessTree(target);
    try {
      await waitForExit(target, kind === 'graceful' ? 65_000 : 5_000);
    } catch (error) {
      await killProcessTree(target).catch(() => {});
      await waitForExit(target, 5_000).catch(() => {});
      throw error;
    }
  };

  const startChild = async (): Promise<void> => {
    childGeneration += 1;
    const generation = childGeneration;
    configPath = await suite.writeScratchJson('hosted/config.json', {
      launchId: generation,
      port: runtime.daemonPort,
      providerBaseUrl: provider!.origin,
      publicOrigin: webUrl,
      runtimeRoot,
    });
    const started = fork(fixturePath, [configPath], {
      cwd: workspaceRoot,
      detached: process.platform !== 'win32',
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    child = started;
    started.stdout?.on('data', (chunk: Buffer | string) => {
      childOutput.push({ generation, stream: 'stdout', text: String(chunk) });
    });
    started.stderr?.on('data', (chunk: Buffer | string) => {
      childOutput.push({ generation, stream: 'stderr', text: String(chunk) });
    });
    daemonUrl = await waitForChildReady(started, childOutput);
    const expected = `http://127.0.0.1:${runtime.daemonPort}`;
    if (daemonUrl !== expected) {
      throw new Error(`hosted fixture bound ${daemonUrl}; expected ${expected}`);
    }
    await assertReady(daemonUrl);
    await assertReady(webUrl);
  };

  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const env = envFor(runtime);
      try {
        const started = await startToolsDevWeb(toolsSuite, runtime, env);
        initialDaemonPid = started.daemon?.pid ?? started.daemon?.status.pid ?? null;
        initialWebPid = started.web?.pid ?? started.web?.status.pid ?? null;
        webUrl = exactLoopbackOrigin(started.web?.status.url, runtime.webPort, 'web');
        break;
      } catch (error) {
        if (attempt === 3 || !isToolsDevPortConflict(error)) throw error;
        await runtime.release().catch(() => {});
        await stopToolsDevWeb(toolsSuite, env).catch(() => {});
        runtime = await allocateToolsDevRuntime();
      }
    }
    if (webUrl === '') throw new Error('hosted web runtime did not start');
    await stopToolsDevProcess(
      () => stopToolsDevDaemon(toolsSuite, envFor(runtime)),
      initialDaemonPid,
    );

    provider = await startProviderFixture();
    await startChild();

    const identity = (value: HostedIdentity): HostedHttpClient => {
      const existing = clients.get(value);
      if (existing != null) return existing;
      const created = createIdentityClient(value, () => webUrl, () => childGeneration);
      clients.set(value, created);
      return created;
    };
    const context: HostedSuiteContext = {
      daemonUrl,
      webUrl,
      runtimeRoot,
      identity,
      provider: {
        credential: (value) => PROVIDER_CREDENTIALS[value],
        requestSummary: () => provider!.requestSummary(),
      },
      restart: async (kind) => {
        await stopChild(kind);
        await startChild();
      },
    };
    await run(context);
    success = true;
  } catch (error) {
    caughtError = error;
    throw error;
  } finally {
    let cleanupError: unknown = null;
    const cleanup = await Promise.allSettled([
      stopChild('graceful'),
      provider?.close() ?? Promise.resolve(),
      stopToolsDevProcess(() => stopToolsDevWeb(toolsSuite, envFor(runtime)), initialWebPid),
      runtime.release(),
    ]);
    cleanupError = cleanup.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason ?? null;
    if (success && cleanupError == null) {
      try {
        await Promise.all([
          rm(runtimeRoot, { force: true, recursive: true }),
          rm(toolsRoot, { force: true, recursive: true }),
        ]);
      } catch (error) {
        cleanupError = error;
      }
    }
    if (cleanupError != null) {
      if (caughtError == null) {
        caughtError = cleanupError;
        success = false;
      }
    }
    const providerSummary = provider?.requestSummary() ?? {
      count: 0,
      maxConcurrentMarkedRequests: 0,
      maxConcurrentMarkedRequestsByCredential: { a: 0, b: 0 },
      requests: [],
    };
    await suite.report.json('hosted/provider-summary.json', providerSummary);
    if (!success || cleanupError != null) {
      await suite.writeScratchJson('hosted/daemon-output.json', childOutput).catch(() => {});
      diagnostics = {
        cleanupError: formatUnknown(cleanupError),
        daemonOutput: childOutput,
        provider: providerSummary,
        runtimeRoot,
        toolsDevLogs: await readToolsDevLogs(toolsSuite, envFor(runtime)).catch((error: unknown) => ({
          error: formatUnknown(error),
        })),
      };
    }
    await suite.finalize({ diagnostics, error: caughtError, success });
    if (cleanupError != null && caughtError === cleanupError) throw cleanupError;
  }
  return suite.report.root;
}

function createIdentityClient(
  identity: HostedIdentity,
  currentOrigin: () => string,
  currentGeneration: () => number,
): HostedHttpClient {
  const headers = Object.freeze({ authorization: `Bearer ${identity}` });
  let csrf: { generation: number; promise: Promise<string> } | null = null;

  const getCsrf = (): Promise<string> => {
    const generation = currentGeneration();
    if (csrf?.generation === generation) return csrf.promise;
    const promise = fetch(localUrl(currentOrigin(), '/api/hosted/session'), { headers })
      .then(async (response) => {
        if (!response.ok) throw await httpFailure(response);
        const session = await response.json() as { csrfToken?: unknown };
        if (typeof session.csrfToken !== 'string') throw new Error('hosted session omitted CSRF token');
        return session.csrfToken;
      });
    csrf = { generation, promise };
    return promise;
  };

  const request = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const method = (init.method ?? 'GET').toUpperCase();
    const requestHeaders = new Headers(init.headers);
    requestHeaders.set('authorization', headers.authorization);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      requestHeaders.set('origin', currentOrigin());
      requestHeaders.set('x-open-design-csrf', await getCsrf());
    }
    return await fetch(localUrl(currentOrigin(), path), { ...init, headers: requestHeaders, method });
  };

  return Object.freeze({
    headers,
    request,
    async json<T>(path: string, init?: RequestInit): Promise<T> {
      const response = await request(path, init);
      if (!response.ok) throw await httpFailure(response);
      return await response.json() as T;
    },
  });
}

async function startProviderFixture(): Promise<ProviderFixture> {
  const requests: ProviderRequest[] = [];
  let activeMarkedRequests = 0;
  let maxConcurrentMarkedRequests = 0;
  const activeByCredential: Record<HostedIdentity, number> = { a: 0, b: 0 };
  const maxByCredential: Record<HostedIdentity, number> = { a: 0, b: 0 };
  const server = createServer(async (request, response) => {
    let trackedCredential: HostedIdentity | null = null;
    try {
      const body = await readRequestBody(request);
      const parsed = parseProviderBody(body);
      const credential = classifyCredential(request);
      const promptMarker = classifyPromptMarker(body);
      requests.push(Object.freeze({
        credential,
        method: request.method ?? 'GET',
        model: parsed.model,
        path: new URL(request.url ?? '/', 'http://fixture').pathname,
        promptMarker,
        stream: parsed.stream,
      }));
      if (parsed.stream === true && credential !== 'unknown' && promptMarker !== 'unknown') {
        trackedCredential = credential;
        activeMarkedRequests += 1;
        activeByCredential[credential] += 1;
        maxConcurrentMarkedRequests = Math.max(maxConcurrentMarkedRequests, activeMarkedRequests);
        maxByCredential[credential] = Math.max(
          maxByCredential[credential],
          activeByCredential[credential],
        );
      }
      if (new URL(request.url ?? '/', 'http://fixture').pathname !== '/v1/messages') {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'not found' } }));
        return;
      }
      if (parsed.stream === true) {
        response.writeHead(200, {
          'cache-control': 'no-cache',
          'content-type': 'text/event-stream',
        });
        const message = {
          id: 'msg_hosted_fixture',
          type: 'message',
          role: 'assistant',
          content: [],
          model: parsed.model ?? 'claude-sonnet-4-5',
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        };
        writeSse(response, 'message_start', { type: 'message_start', message });
        writeSse(response, 'content_block_start', {
          type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' },
        });
        await delay(body.includes('[hold-for-cancel]') ? 5_000 : 400);
        if (response.destroyed) return;
        writeSse(response, 'content_block_delta', {
          type: 'content_block_delta', index: 0,
          delta: { type: 'text_delta', text: 'Hosted acceptance complete.' },
        });
        writeSse(response, 'content_block_stop', { type: 'content_block_stop', index: 0 });
        writeSse(response, 'message_delta', {
          type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 4 },
        });
        writeSse(response, 'message_stop', { type: 'message_stop' });
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        id: 'msg_hosted_fixture',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'OK' }],
        model: parsed.model ?? 'claude-sonnet-4-5',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }));
    } catch (error) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'invalid fixture request' } }));
    } finally {
      if (trackedCredential != null) {
        activeMarkedRequests -= 1;
        activeByCredential[trackedCredential] -= 1;
      }
    }
  });
  await listen(server);
  const address = server.address();
  if (address == null || typeof address === 'string') throw new Error('provider fixture did not bind TCP');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requestSummary: () => Object.freeze({
      count: requests.length,
      maxConcurrentMarkedRequests,
      maxConcurrentMarkedRequestsByCredential: { ...maxByCredential },
      requests: [...requests],
    }),
    close: () => closeServer(server),
  };
}

function classifyCredential(request: IncomingMessage): HostedIdentity | 'unknown' {
  const authorization = request.headers.authorization;
  const value = request.headers['x-api-key']
    ?? (typeof authorization === 'string' && authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : undefined);
  return value === PROVIDER_CREDENTIALS.a
    ? 'a'
    : value === PROVIDER_CREDENTIALS.b
      ? 'b'
      : 'unknown';
}

function parseProviderBody(body: string): { model: string | null; stream: boolean | null } {
  try {
    const value = JSON.parse(body) as { model?: unknown; stream?: unknown };
    return {
      model: typeof value.model === 'string' ? value.model : null,
      stream: typeof value.stream === 'boolean' ? value.stream : null,
    };
  } catch {
    return { model: null, stream: null };
  }
}

function classifyPromptMarker(body: string): HostedIdentity | 'mixed' | 'unknown' {
  const hasA = body.includes('[tenant-a-marker]');
  const hasB = body.includes('[tenant-b-marker]');
  return hasA && hasB ? 'mixed' : hasA ? 'a' : hasB ? 'b' : 'unknown';
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    request.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > 1024 * 1024) {
        request.destroy(new Error('provider fixture request is too large'));
        return;
      }
      chunks.push(buffer);
    });
    request.once('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    request.once('error', rejectBody);
  });
}

function writeSse(
  response: import('node:http').ServerResponse,
  event: string,
  data: unknown,
): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function listen(server: Server): Promise<void> {
  return new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => resolveListen());
  });
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => error == null ? resolveClose() : rejectClose(error));
  });
}

function waitForChildReady(
  child: ChildProcess,
  output: Array<{ generation: number; stream: 'stderr' | 'stdout'; text: string }>,
): Promise<string> {
  return new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(() => finish(new Error('hosted fixture readiness timed out')), READY_TIMEOUT_MS);
    const onMessage = (message: unknown): void => {
      if (
        typeof message === 'object'
        && message != null
        && (message as { type?: unknown }).type === 'ready'
        && typeof (message as { url?: unknown }).url === 'string'
      ) finish(undefined, (message as { url: string }).url);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      const tail = output.slice(-10).map((entry) => entry.text).join('').trim();
      finish(new Error(`hosted fixture exited before ready (${code ?? signal ?? 'unknown'})${tail ? `: ${tail}` : ''}`));
    };
    const finish = (error?: Error, url?: string): void => {
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('exit', onExit);
      if (error != null) rejectReady(error);
      else resolveReady(url!);
    };
    child.on('message', onMessage);
    child.once('exit', onExit);
  });
}

async function assertReady(origin: string): Promise<void> {
  const response = await fetch(`${origin}/api/ready`);
  if (!response.ok) throw new Error(`hosted readiness failed through ${origin}: HTTP ${response.status}`);
  const body = await response.json() as { ready?: unknown };
  if (body.ready !== true) throw new Error(`hosted readiness returned an invalid body through ${origin}`);
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode != null || child.signalCode != null) return Promise.resolve();
  return new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      rejectExit(new Error('hosted fixture did not exit'));
    }, timeoutMs);
    const onExit = (): void => {
      clearTimeout(timer);
      resolveExit();
    };
    child.once('exit', onExit);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function killProcessTree(child: ChildProcess): Promise<void> {
  if (child.pid == null || child.exitCode != null || child.signalCode != null) return;
  await killPidTree(child.pid, true);
}

async function killPidTree(pid: number, processGroup = false): Promise<void> {
  if (!isProcessAlive(pid)) return;
  if (process.platform === 'win32') {
    const { execFile } = await import('node:child_process');
    await new Promise<void>((resolveKill, rejectKill) => {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, (error) => {
        if (error == null || !isProcessAlive(pid)) resolveKill();
        else rejectKill(error);
      });
    });
    return;
  }
  try {
    process.kill(processGroup ? -pid : pid, 'SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function stopToolsDevProcess(stop: () => Promise<ToolsDevStopResult>, pid: number | null): Promise<void> {
  let result: ToolsDevStopResult;
  try {
    result = await stop();
  } catch (error) {
    if (pid == null || !isProcessAlive(pid)) throw error;
    await killPidTree(pid, true);
    return;
  }
  if (Object.values(result).some((entry) => (
    entry.status === 'partial' || (entry.stop?.remainingPids?.length ?? 0) > 0
  ))) throw new Error('tools-dev left hosted test processes running');
}

function exactLoopbackOrigin(value: string | null | undefined, port: number, label: string): string {
  const expected = `http://127.0.0.1:${port}`;
  if (value !== expected) throw new Error(`${label} runtime exposed ${String(value)}; expected ${expected}`);
  return expected;
}

function localUrl(origin: string, path: string): URL {
  const url = new URL(path, `${origin}/`);
  if (url.origin !== origin) throw new Error('hosted test client path must stay on its web origin');
  return url;
}

async function httpFailure(response: Response): Promise<Error> {
  const body = await response.text();
  return new Error(`hosted request failed: HTTP ${response.status}${body ? ` ${body}` : ''}`);
}

function formatUnknown(value: unknown): string | null {
  if (value == null) return null;
  return value instanceof Error ? value.stack ?? value.message : String(value);
}
