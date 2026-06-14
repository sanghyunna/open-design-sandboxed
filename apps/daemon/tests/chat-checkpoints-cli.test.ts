import http from 'node:http';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_ROOT = pathResolve(__dirname, '..');
const REPO_ROOT = pathResolve(__dirname, '../../..');
const CLI_SRC = pathResolve(__dirname, '../src/cli.ts');
const TSX_CLI = pathResolve(REPO_ROOT, 'node_modules/tsx/dist/cli.mjs');

interface CapturedRequest {
  method: string;
  url: string;
  body: string;
}

interface StubServer {
  baseUrl: string;
  requests: CapturedRequest[];
  setResponder: (
    fn: (req: CapturedRequest) => { status: number; body: unknown } | null,
  ) => void;
  close: () => Promise<void>;
}

async function startStubServer(): Promise<StubServer> {
  const requests: CapturedRequest[] = [];
  let responder:
    | ((req: CapturedRequest) => { status: number; body: unknown } | null)
    | null = null;

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const captured: CapturedRequest = {
        method: req.method ?? '',
        url: req.url ?? '',
        body: raw,
      };
      requests.push(captured);
      const response = responder?.(captured) ?? { status: 200, body: { ok: true } };
      res.statusCode = response.status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(response.body));
    });
  });

  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('stub server has no address');

  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    requests,
    setResponder: (fn) => {
      responder = fn;
    },
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((err) => (err ? rejectClose(err) : resolveClose()));
      }),
  };
}

async function runCli(
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.NODE_OPTIONS;
  try {
    const { stdout, stderr } = await execFileP(
      process.execPath,
      [TSX_CLI, CLI_SRC, ...args],
      {
        cwd: DAEMON_ROOT,
        env,
        timeout: 15_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const failed = err as { stdout?: string; stderr?: string; code?: number | null };
    return {
      stdout: failed.stdout ?? '',
      stderr: failed.stderr ?? '',
      code: failed.code ?? 1,
    };
  }
}

describe('od chat checkpoint CLI', () => {
  let stub: StubServer;

  beforeAll(async () => {
    stub = await startStubServer();
  });

  afterAll(async () => {
    await stub.close();
  });

  beforeEach(() => {
    stub.requests.length = 0;
    stub.setResponder(() => ({ status: 200, body: { ok: true } }));
  });

  it('prints checkpoint list API JSON under --json', async () => {
    const payload = {
      checkpoints: [
        {
          id: 'cp-1',
          projectId: 'proj-1',
          conversationId: 'conv-1',
          messageId: 'msg-1',
          runId: 'run-1',
          kind: 'after_message',
          createdAt: 1_700_000_000_000,
          rootPathHash: 'root',
          fileCount: 2,
          totalBytes: 120,
          manifestHash: 'manifest',
          restoreModes: ['files_only', 'chat_only', 'files_and_chat'],
        },
      ],
    };
    stub.setResponder((req) => {
      if (
        req.method === 'GET'
        && req.url === '/api/projects/proj-1/checkpoints?conversationId=conv-1'
      ) {
        return { status: 200, body: payload };
      }
      return { status: 404, body: { error: 'unexpected' } };
    });

    const result = await runCli([
      'chat',
      'checkpoints',
      '--project',
      'proj-1',
      '--conversation',
      'conv-1',
      '--daemon-url',
      stub.baseUrl,
      '--json',
    ]);

    expect(result.code).toBe(0);
    expect(stub.requests).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toEqual(payload);
  });

  it('prints checkpoint diff API JSON under --json', async () => {
    const payload = {
      checkpoint: { id: 'cp-1', projectId: 'proj-1', kind: 'after_message' },
      files: [{ path: 'src/app.ts', status: 'modified' }],
      conflicts: [],
    };
    stub.setResponder((req) => {
      if (
        req.method === 'GET'
        && req.url === '/api/projects/proj-1/checkpoints/cp-1/diff?base=current'
      ) {
        return { status: 200, body: payload };
      }
      return { status: 404, body: { error: 'unexpected' } };
    });

    const result = await runCli([
      'chat',
      'checkpoint',
      'diff',
      '--project',
      'proj-1',
      '--checkpoint',
      'cp-1',
      '--daemon-url',
      stub.baseUrl,
      '--json',
    ]);

    expect(result.code).toBe(0);
    expect(stub.requests).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toEqual(payload);
  });

  it('POSTs rollback mode, checkpoint, and conflict policy to the daemon', async () => {
    const payload = {
      projectId: 'proj-1',
      conversationId: 'conv-1',
      mode: 'files_and_chat',
      targetMessageId: 'msg-1',
      restoredCheckpointId: 'cp-1',
      safetyCheckpointId: 'cp-safe',
      deletedMessageIds: ['msg-2'],
      clearedAgentSessions: true,
      fileChanges: { added: 0, modified: 1, deleted: 1, unchanged: 2 },
      conflicts: [],
    };
    stub.setResponder((req) => {
      if (
        req.method === 'POST'
        && req.url === '/api/projects/proj-1/conversations/conv-1/rollback'
      ) {
        return { status: 200, body: payload };
      }
      return { status: 404, body: { error: 'unexpected' } };
    });

    const result = await runCli([
      'chat',
      'rollback',
      '--project',
      'proj-1',
      '--conversation',
      'conv-1',
      '--message',
      'msg-1',
      '--checkpoint',
      'cp-1',
      '--mode',
      'files-and-chat',
      '--conflict-policy',
      'keep-current',
      '--daemon-url',
      stub.baseUrl,
      '--json',
    ]);

    expect(result.code).toBe(0);
    expect(stub.requests).toHaveLength(1);
    expect(JSON.parse(stub.requests[0]!.body)).toEqual({
      targetMessageId: 'msg-1',
      targetCheckpointId: 'cp-1',
      mode: 'files_and_chat',
      conflictPolicy: 'keep_current',
      createSafetyCheckpoint: true,
    });
    expect(JSON.parse(result.stdout)).toEqual(payload);
  });

  it('prints a human rollback summary with the safety checkpoint recovery command', async () => {
    stub.setResponder(() => ({
      status: 200,
      body: {
        projectId: 'proj-1',
        conversationId: 'conv-1',
        mode: 'files_only',
        targetMessageId: 'msg-1',
        restoredCheckpointId: 'cp-1',
        safetyCheckpointId: 'cp-safe',
        deletedMessageIds: [],
        clearedAgentSessions: false,
        fileChanges: { added: 1, modified: 2, deleted: 3, unchanged: 4 },
        conflicts: [],
      },
    }));

    const result = await runCli([
      'chat',
      'rollback',
      '--project',
      'proj-1',
      '--conversation',
      'conv-1',
      '--message',
      'msg-1',
      '--checkpoint',
      'cp-1',
      '--mode',
      'files-only',
      '--daemon-url',
      stub.baseUrl,
    ]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('[chat rollback] restored cp-1');
    expect(result.stdout).toContain('safetyCheckpoint\tcp-safe');
    expect(result.stdout).toContain('files\t1 added, 2 modified, 3 deleted, 4 unchanged');
    expect(result.stdout).toContain('recovery\tod chat rollback --project proj-1 --conversation conv-1 --message msg-1 --checkpoint cp-safe --mode files-only');
  });

  it('maps rollback conflicts to a non-zero structured JSON error', async () => {
    stub.setResponder(() => ({
      status: 409,
      body: {
        error: {
          code: 'ROLLBACK_CONFLICT',
          message: 'Rollback has file conflicts.',
          conflicts: [
            { path: 'src/app.ts', reason: 'current_changed_since_checkpoint' },
          ],
        },
      },
    }));

    const result = await runCli([
      'chat',
      'rollback',
      '--project',
      'proj-1',
      '--conversation',
      'conv-1',
      '--message',
      'msg-1',
      '--mode',
      'files-and-chat',
      '--daemon-url',
      stub.baseUrl,
      '--json',
    ]);

    expect(result.code).toBe(76);
    const envelope = JSON.parse(result.stderr);
    expect(envelope.error.code).toBe('rollback-conflict');
    expect(envelope.error.message).toBe('Rollback has file conflicts.');
    expect(envelope.error.data.conflicts).toEqual([
      { path: 'src/app.ts', reason: 'current_changed_since_checkpoint' },
    ]);
  });

  it('requires an explicit rollback mode before calling the daemon', async () => {
    const result = await runCli([
      'chat',
      'rollback',
      '--project',
      'proj-1',
      '--conversation',
      'conv-1',
      '--message',
      'msg-1',
      '--daemon-url',
      stub.baseUrl,
    ]);

    expect(result.code).toBe(2);
    expect(stub.requests).toHaveLength(0);
    expect(result.stderr).toContain('--mode is required');
  });
});
