import { spawn } from 'node:child_process';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  isolatedAgentEnv,
  startIsolatedToolBroker,
} from '../src/isolated-agent-runtime.js';
import { spawnIsolatedAgent } from '@open-design/platform';

const roots: string[] = [];
const nativeHelper = fileURLToPath(
  new URL('../../../packages/platform/dist/native/win32/od-agent-isolator.exe', import.meta.url),
);
const nativeAvailable = process.platform === 'win32' && existsSync(nativeHelper);

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function collect(command: string, args: string[], env: NodeJS.ProcessEnv, input = '') {
  const child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end(input);
  return collectChild(child);
}

async function collectChild(child: import('node:child_process').ChildProcess) {
  let stdout = '';
  let stderr = '';
  if (child.stdout == null || child.stderr == null) throw new Error('child pipes are required');
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  return { code, stderr, stdout };
}

describe('isolated agent tool broker', () => {
  it('rejects host executables inside the agent-writable project', async () => {
    const fixture = await mkdtemp(path.join(os.tmpdir(), 'od-isolated-broker-overlap-'));
    roots.push(fixture);
    await expect(startIsolatedToolBroker({
      agentEnv: {},
      agentId: 'codex',
      cwd: fixture,
      daemonUrl: 'http://127.0.0.1:7456',
      hostEnv: {},
      hostNodeBin: process.execPath,
      hostOdBin: path.join(fixture, 'mutable-cli.mjs'),
      projectDir: fixture,
      projectId: 'project-overlap',
      runId: `overlap-${Date.now()}`,
      toolToken: 'tool-secret',
    })).rejects.toThrow(/outside the agent-writable project/);
  });

  it('brokers only the four daemon tool operations without following agent paths', async () => {
    const fixture = await mkdtemp(path.join(os.tmpdir(), 'od-isolated-broker-test-'));
    roots.push(fixture);
    const project = path.join(fixture, 'project');
    await mkdir(project);
    const hostCli = path.join(fixture, 'host-cli.mjs');
    const invoked = path.join(fixture, 'invoked.json');
    await writeFile(hostCli, `
      import { writeFile } from 'node:fs/promises';
      await writeFile(${JSON.stringify(invoked)}, JSON.stringify({ args: process.argv.slice(2) }));
      process.stdout.write(JSON.stringify({
        hasDaemonUrl: Boolean(process.env.OD_DAEMON_URL),
        hasToolToken: Boolean(process.env.OD_TOOL_TOKEN),
        projectId: process.env.OD_PROJECT_ID,
      }));
    `, 'utf8');
    const broker = await startIsolatedToolBroker({
      agentEnv: {},
      agentId: 'codex',
      cwd: project,
      daemonUrl: 'http://127.0.0.1:7456',
      hostEnv: {},
      hostNodeBin: process.execPath,
      hostOdBin: hostCli,
      projectDir: project,
      projectId: 'project-1',
      runId: `run-${Date.now()}`,
      toolToken: 'tool-secret',
    });
    roots.push(broker.paths.root);
    try {
      const agentEnv = isolatedAgentEnv({
        Od_Data_Dir: 'protected',
        OD_DAEMON_URL: 'http://127.0.0.1:7456',
        OD_DESKTOP_APPROVAL_TOKEN: 'approval-secret',
        OD_SIDECAR_IPC_PATH: '\\\\.\\pipe\\privileged',
        OD_TOOL_TOKEN: 'tool-secret',
      }, broker, 'codex');
      expect(Object.keys(agentEnv).map((key) => key.toUpperCase())).not.toContain('OD_DATA_DIR');
      expect(agentEnv.OD_DAEMON_URL).toBeUndefined();
      expect(agentEnv.OD_DESKTOP_APPROVAL_TOKEN).toBeUndefined();
      expect(agentEnv.OD_SIDECAR_IPC_PATH).toBeUndefined();
      expect(agentEnv.OD_TOOL_TOKEN).toBeUndefined();
      expect(agentEnv.OD_BIN).toBe(broker.paths.clientPath);
      expect(agentEnv.OD_ISOLATED_TOOL_BROKER_ROOT).toBeUndefined();
      expect(broker.ipc.pipeName).toMatch(/^\\\\\.\\pipe\\LOCAL\\OpenDesign\./);

      const token = broker.clientEnv.OD_ISOLATED_TOOL_BROKER_TOKEN!;
      const allowed = JSON.parse(await broker.ipc.handleRequest(JSON.stringify({
        args: ['tools', 'connectors', 'list', '--format', 'compact'],
        token,
      })));
      expect(allowed).toMatchObject({ code: 0, stderr: '' });
      expect(JSON.parse(allowed.stdout)).toEqual({
        hasDaemonUrl: true,
        hasToolToken: true,
        projectId: 'project-1',
      });
      expect(JSON.parse(await readFile(invoked, 'utf8'))).toEqual({
        args: ['tools', 'connectors', 'list', '--format', 'compact'],
      });

      const execute = JSON.parse(await broker.ipc.handleRequest(JSON.stringify({
        args: [
          'tools', 'connectors', 'execute', '--connector', 'github', '--tool', 'read', '--input', 'request.json',
        ],
        input: '{"owner":"open-design"}',
        token,
      })));
      expect(execute.code).toBe(0);
      const executeArgs = JSON.parse(await readFile(invoked, 'utf8')).args as string[];
      expect(executeArgs.slice(0, 7)).toEqual([
        'tools', 'connectors', 'execute', '--connector', 'github', '--tool', 'read',
      ]);
      expect(executeArgs[8]).toContain('open-design-isolated-broker-host');
      expect(executeArgs[8]).not.toContain('request.json');

      const designSystem = JSON.parse(await broker.ipc.handleRequest(JSON.stringify({
        args: ['tools', 'design-systems', 'read', '--path', 'preview/colors.html'],
        token,
      })));
      expect(designSystem.code).toBe(0);

      for (const args of [
        ['project', 'list'],
        ['tools', 'connectors', 'local-design-context', '--path', '.'],
        ['tools', 'connectors', 'design-system-package-audit', '--path', '.'],
        ['tools', 'connectors', 'execute', '--connector', 'github', '--tool', 'read', '--input', 'C:\\protected.json'],
      ]) {
        const result = JSON.parse(await broker.ipc.handleRequest(JSON.stringify({ args, input: '{}', token })));
        expect(result.code, args.join(' ')).toBe(126);
      }
      expect(JSON.parse(await broker.ipc.handleRequest(JSON.stringify({
        args: ['tools', 'connectors', 'list'],
        token: 'wrong-token',
      }))).code).toBe(126);
    } finally {
      await broker.close();
    }
  }, 15_000);

  it('preserves media:generate through the same authenticated narrow broker', async () => {
    let observed: { authorization: string | undefined; body: unknown } = {
      authorization: undefined,
      body: undefined,
    };
    const server = http.createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      observed = {
        authorization: req.headers.authorization,
        body: JSON.parse(body),
      };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ artifactId: 'media-1' }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('media broker test server has no port');
    const broker = await startIsolatedToolBroker({
      agentEnv: {},
      agentId: 'codex',
      cwd: process.cwd(),
      daemonUrl: `http://127.0.0.1:${address.port}`,
      hostEnv: {},
      hostNodeBin: process.execPath,
      hostOdBin: process.execPath,
      projectDir: process.cwd(),
      projectId: 'project-media',
      runId: `media-${Date.now()}`,
      toolToken: 'media-tool-token',
    });
    roots.push(broker.paths.root);
    try {
      const result = JSON.parse(await broker.ipc.handleRequest(JSON.stringify({
        args: ['tools', 'media', 'generate', '--input', 'media.json'],
        input: '{"prompt":"draw a circle"}',
        token: broker.clientEnv.OD_ISOLATED_TOOL_BROKER_TOKEN,
      })));
      expect(result).toMatchObject({ code: 0, stderr: '' });
      expect(JSON.parse(result.stdout)).toEqual({ artifactId: 'media-1' });
      expect(observed).toEqual({
        authorization: 'Bearer media-tool-token',
        body: { prompt: 'draw a circle' },
      });
    } finally {
      await broker.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it.skipIf(!nativeAvailable)('brokers an od tools command from a real contained native process', async () => {
    const fixture = await mkdtemp(path.join(os.tmpdir(), 'od-isolated-native-broker-test-'));
    roots.push(fixture);
    const project = path.join(fixture, 'project');
    await mkdir(project);
    const hostCli = path.join(fixture, 'host-cli.mjs');
    await writeFile(hostCli, "process.stdout.write('native-broker-ok');\n", 'utf8');
    const broker = await startIsolatedToolBroker({
      agentEnv: {},
      agentId: 'codex',
      cwd: project,
      daemonUrl: 'http://127.0.0.1:7456',
      hostEnv: {},
      hostNodeBin: process.execPath,
      hostOdBin: hostCli,
      projectDir: project,
      projectId: 'project-native',
      runId: `native-${Date.now()}`,
      toolToken: 'tool-secret',
    });
    roots.push(broker.paths.root);
    try {
      const env = isolatedAgentEnv(process.env, broker, 'codex');
      const child = await spawnIsolatedAgent({
        args: [
          '--harness-spawn-external',
          broker.paths.nodeBin,
          '--preserve-symlinks-main',
          broker.paths.clientPath,
          'tools',
          'connectors',
          'list',
        ],
        command: nativeHelper,
        cwd: project,
        env,
        broker: broker.ipc,
        readExecutePaths: [dirname(nativeHelper)],
        writablePaths: [project, broker.paths.root],
      });
      child.stdin.end();
      const result = await collectChild(child);
      expect(result, result.stderr).toMatchObject({ code: 0, stdout: 'native-broker-ok' });
    } finally {
      await broker.close();
    }
  }, 20_000);
});
