import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { spawnWaitingForOutputLine } from './child-readiness.js';

const execFileAsync = promisify(execFile);
const daemonRoot = fileURLToPath(new URL('..', import.meta.url));
// Exercise the same built entry users launch. Spawning cli.ts through tsx made
// readiness depend on cold transpilation of the daemon graph rather than bind.
const cliEntry = fileURLToPath(new URL('../bin/od.mjs', import.meta.url));

describe('CLI startup boundaries', () => {
  it.each([
    ['doctor', ['doctor', '--help']],
    ['config', ['config', 'get', 'apiProtocol', '--daemon-url', 'http://127.0.0.1:9']],
    ['diagnostics', ['diagnostics', 'export', '--daemon-url', 'http://127.0.0.1:9']],
  ])('initializes flag constants before dispatching od %s', async (_name, args) => {
    let output = '';
    try {
      const result = await execFileAsync(
        process.execPath,
        [cliEntry, ...args],
        {
          cwd: daemonRoot,
          env: { ...process.env },
        },
      );
      output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    } catch (error: unknown) {
      const failed = error as { stdout?: string; stderr?: string };
      output = `${failed.stdout ?? ''}${failed.stderr ?? ''}`;
    }

    expect(output).not.toContain('ReferenceError');
    expect(output).not.toContain('before initialization');
    expect(output).not.toContain('CONFIG_STRING_FLAGS');
    expect(output).not.toContain('DIAGNOSTICS_STRING_FLAGS');
  });

  it('captures an immediately emitted readiness line through the launch seam', async () => {
    const launched = spawnWaitingForOutputLine(
      process.execPath,
      ['-e', "process.stdout.write('[od] listening on http://127.0.0.1:1 (headless)\\n')"],
      {},
      /\[od\] listening on (http:\/\/[^\s]+) \(headless\)/u,
    );
    await expect(launched.line).resolves.toContain('http://127.0.0.1:1');
  });

  it('keeps od daemon start alive until SIGTERM and reports the actual listening port', async () => {
    const root = await mkdtemp(join(tmpdir(), 'od-cli-daemon-start-'));
    const dataDir = join(root, 'data');
    await mkdir(dataDir);
    const launched = spawnWaitingForOutputLine(
      process.execPath,
      [
        cliEntry,
        'daemon',
        'start',
        '--headless',
        '--port',
        '0',
      ],
      {
        cwd: daemonRoot,
        env: {
          ...process.env,
          OD_BIND_HOST: '127.0.0.1',
          OD_DATA_DIR: dataDir,
        },
      },
      /\[od\] listening on (http:\/\/[^\s]+) \(headless\)/u,
    );
    const { child } = launched;

    try {
      const line = await launched.line;
      const match = line.match(/(http:\/\/[^\s]+)/u);
      const daemonUrl = match?.[1];
      expect(daemonUrl).toBeTruthy();
      const parsed = new URL(daemonUrl!);
      expect(Number(parsed.port)).toBeGreaterThan(0);

      const healthResp = await fetch(`${daemonUrl}/api/health`);
      expect(healthResp.status).toBe(200);

      const statusResp = await fetch(`${daemonUrl}/api/daemon/status`);
      expect(statusResp.status).toBe(200);
      const status = await statusResp.json() as { bindHost: string; port: number };
      expect(status.bindHost).toBe('127.0.0.1');
      expect(status.port).toBe(Number(parsed.port));
      expect(child.exitCode).toBeNull();
    } finally {
      await terminateChild(child);
      await rm(root, { recursive: true, force: true });
    }
  });

});


async function terminateChild(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
  });
  child.kill('SIGTERM');
  const timeout = new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 5_000);
    timer.unref?.();
  });
  await Promise.race([exited, timeout]);
}
