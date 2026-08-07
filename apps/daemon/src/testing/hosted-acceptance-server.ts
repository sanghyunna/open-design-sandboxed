import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  startHostedServer,
  type HostedResolvedIdentity,
} from '../hosted-server.js';
import { startHostedPiTurn } from '../runtimes/hosted-pi-turn.js';

type FixtureConfig = {
  launchId: number;
  port: number;
  providerBaseUrl: string;
  publicOrigin: string;
  runtimeRoot: string;
};

const identities = Object.freeze({
  a: Object.freeze({
    displayName: 'Hosted A',
    sessionKey: 'hosted-acceptance-session-a',
    userKey: 'hosted-acceptance-user-a',
  }),
  b: Object.freeze({
    displayName: 'Hosted B',
    sessionKey: 'hosted-acceptance-session-b',
    userKey: 'hosted-acceptance-user-b',
  }),
} satisfies Record<string, HostedResolvedIdentity>);

if (process.env.NODE_ENV !== 'test') fail();

try {
  const config = readConfig(process.argv[2]);
  const counters = new Map<string, number>();
  const hosted = await startHostedServer({
    host: '127.0.0.1',
    port: config.port,
    publicOrigin: config.publicOrigin,
    runtimeRoot: config.runtimeRoot,
    testComposition: {
      createEntityId(kind, userKey) {
        return nextId(counters, config.launchId, userKey, kind);
      },
      createRunId(userKey) {
        return nextId(counters, config.launchId, userKey, 'run');
      },
      eventBudgetLimits: { heartbeatMs: 100 },
      providerBaseUrls: {
        anthropic: config.providerBaseUrl,
        'vercel-ai-gateway': config.providerBaseUrl,
      },
      resolveIdentity(request) {
        const bearer = bearerIdentity(request.headers.authorization);
        const cookie = cookieIdentity(request.headers.cookie);
        if (bearer === null || cookie === null || (bearer && cookie && bearer !== cookie)) {
          return null;
        }
        const identity = bearer ?? cookie;
        return identity === undefined ? null : identities[identity];
      },
      startTurn(input, dependencies) {
        return startHostedPiTurn(input, {
          ...dependencies,
          spawnChild(command, args, options) {
            fs.writeFileSync(
              path.join(options.env!.PI_CODING_AGENT_DIR!, 'models.json'),
              JSON.stringify({ providers: { anthropic: { baseUrl: config.providerBaseUrl } } }),
            );
            const child = spawn(command, [...args], options);
            child.once('spawn', () => {
              process.stderr.write(`${JSON.stringify({ type: 'pi-child', event: 'spawn' })}\n`);
            });
            child.once('close', (exitCode, signal) => {
              process.stderr.write(`${JSON.stringify({
                type: 'pi-child', event: 'close', exitCode, signal,
              })}\n`);
            });
            child.once('error', (error) => {
              process.stderr.write(`${JSON.stringify({
                type: 'pi-child', event: 'error', code: (error as NodeJS.ErrnoException).code ?? null,
              })}\n`);
            });
            child.stderr?.on('data', (chunk: Buffer | string) => {
              let text = String(chunk).slice(0, 2_000);
              for (const secret of Object.values(options.env ?? {})) {
                if (typeof secret === 'string' && secret.length > 3) text = text.replaceAll(secret, '[redacted]');
              }
              for (const owned of [config.providerBaseUrl, config.runtimeRoot, process.cwd()]) {
                text = text.replaceAll(owned, '[redacted]');
              }
              process.stderr.write(`${JSON.stringify({ type: 'pi-stderr', text })}\n`);
            });
            return child;
          },
        }).then((result) => {
          if (result.value.status === 'failed') {
            process.stderr.write(`${JSON.stringify({
              type: 'turn-terminal',
              exitCode: result.value.exitCode,
              signal: result.value.signal,
              status: result.value.status,
            })}\n`);
          }
          return result;
        }).catch((error: unknown) => {
          const failure = error as { code?: unknown; message?: unknown; name?: unknown };
          process.stderr.write(`${JSON.stringify({
            type: 'turn-failure',
            code: typeof failure.code === 'string' ? failure.code : null,
            message: typeof failure.message === 'string' ? failure.message : 'hosted turn failed',
            name: typeof failure.name === 'string' ? failure.name : 'Error',
          })}\n`);
          throw error;
        });
      },
    },
  });
  let stopping: Promise<void> | null = null;
  const stop = (exitCode: number): Promise<void> => {
    stopping ??= hosted.shutdown().then(() => {
      process.exitCode = exitCode;
      if (process.connected) process.disconnect();
    });
    return stopping;
  };
  process.on('message', (message: unknown) => {
    if (isShutdownMessage(message)) void stop(0).catch(fail);
  });
  process.once('disconnect', () => { void stop(0).catch(fail); });
  process.once('SIGINT', () => { void stop(0).catch(fail); });
  process.once('SIGTERM', () => { void stop(0).catch(fail); });
  if (!process.send) fail();
  process.send({ type: 'ready', url: hosted.url });
} catch {
  fail();
}

function readConfig(candidate: string | undefined): FixtureConfig {
  if (candidate == null || !path.isAbsolute(candidate)) fail();
  const stat = fs.lstatSync(candidate);
  const resolved = fs.realpathSync(candidate);
  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || !samePath(candidate, resolved)
    || stat.size < 2
    || stat.size > 16 * 1024
  ) fail();
  const value: unknown = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (value == null || typeof value !== 'object' || Array.isArray(value)) fail();
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(',')
      !== 'launchId,port,providerBaseUrl,publicOrigin,runtimeRoot'
  ) {
    fail();
  }
  if (
    !Number.isSafeInteger(record.launchId)
    || (record.launchId as number) < 1
    || !Number.isSafeInteger(record.port)
    || (record.port as number) < 1
    || (record.port as number) > 65_535
    || typeof record.runtimeRoot !== 'string'
    || !path.isAbsolute(record.runtimeRoot)
    || !isExactOrigin(record.publicOrigin, false)
    || !isExactOrigin(record.providerBaseUrl, true)
  ) fail();
  return {
    launchId: record.launchId as number,
    port: record.port as number,
    providerBaseUrl: record.providerBaseUrl as string,
    publicOrigin: record.publicOrigin as string,
    runtimeRoot: path.resolve(record.runtimeRoot),
  };
}

function isExactOrigin(value: unknown, loopbackOnly: boolean): value is string {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.origin === value
      && parsed.username === ''
      && parsed.password === ''
      && (loopbackOnly
        ? parsed.protocol === 'http:' && ['127.0.0.1', '::1', 'localhost'].includes(parsed.hostname)
        : parsed.protocol === 'http:' || parsed.protocol === 'https:');
  } catch {
    return false;
  }
}

function bearerIdentity(header: string | undefined): keyof typeof identities | null | undefined {
  if (header === undefined) return undefined;
  const match = /^Bearer ([ab])$/u.exec(header);
  return match?.[1] as keyof typeof identities | undefined ?? null;
}

function cookieIdentity(header: string | undefined): keyof typeof identities | null | undefined {
  if (header === undefined) return undefined;
  const values = header.split(';').map((part) => part.trim()).flatMap((part) => {
    const index = part.indexOf('=');
    return index > 0 && part.slice(0, index) === 'od-e2e-identity'
      ? [part.slice(index + 1)]
      : [];
  });
  return values.length === 0
    ? undefined
    : values.length === 1 && (values[0] === 'a' || values[0] === 'b')
      ? values[0]
      : null;
}

function nextId(
  values: Map<string, number>,
  launchId: number,
  userKey: string,
  kind: 'project' | 'conversation' | 'message' | 'run',
): string {
  const key = `${userKey}\0${kind}`;
  const value = (values.get(key) ?? 0) + 1;
  values.set(key, value);
  return `${kind}-${launchId}-${value}`;
}

function isShutdownMessage(value: unknown): boolean {
  return value != null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === 1
    && (value as { type?: unknown }).type === 'shutdown';
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function fail(): never {
  if (process.send) {
    try { process.send({ type: 'fatal', message: 'hosted acceptance launcher failed' }); } catch {}
  }
  process.stderr.write('hosted acceptance launcher failed\n');
  process.exit(1);
}
