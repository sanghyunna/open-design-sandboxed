import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, test } from 'vitest';
import {
  createHostedPiInvocation,
  resolveHostedPiEntrypoint,
} from '../src/runtimes/hosted-pi-runtime.js';
import type { HostedPiRuntimeRequest } from '../src/runtimes/hosted-pi-runtime.js';
import { createHostedPiBroker } from '../src/runtimes/hosted-pi-broker.js';
import { createHostedPiRuntimeAdapter } from '../src/runtimes/hosted-pi-adapter.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fakePiPackage(): { root: string; entrypoint: string; project: string; sessionDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'od-hosted-pi-'));
  roots.push(root);
  const entrypoint = join(root, 'dist', 'rpc-entry.js');
  const project = join(root, 'project');
  const sessionDir = join(root, 'sessions');
  mkdirSync(join(root, 'dist'), { recursive: true });
  mkdirSync(project, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: '@earendil-works/pi-coding-agent',
    version: '0.83.0',
  }));
  writeFileSync(entrypoint, '');
  return { root, entrypoint, project, sessionDir };
}

describe('hosted Pi runtime', () => {
  test('resolves the installed package through its ESM RPC export by default', () => {
    const resolved = resolveHostedPiEntrypoint();
    assert.match(resolved.entrypoint, /rpc-entry\.js$/i);
    assert.equal(resolved.packageRoot.endsWith('pi-coding-agent'), true);
  });

  test('resolves only the pinned package-local RPC entrypoint', () => {
    const fixture = fakePiPackage();
    const resolved = resolveHostedPiEntrypoint(fixture.root);
    assert.equal(resolved.packageRoot, fixture.root);
    assert.equal(resolved.entrypoint, fixture.entrypoint);
  });

  test('rejects an entrypoint that escapes the deployed package root', () => {
    const fixture = fakePiPackage();
    rmSync(fixture.entrypoint);
    writeFileSync(join(fixture.root, 'dist', 'rpc-entry.js'), '');
    const outside = join(fixture.root, '..', 'rpc-entry.js');
    rmSync(outside, { force: true });

    assert.throws(
      () => resolveHostedPiEntrypoint(join(fixture.root, 'dist', '..', 'rpc-entry.js')),
      /package|entrypoint|pinned/i,
    );
  });

  test('uses node and hardening flags without ambient CLI or package-manager authority', () => {
    const fixture = fakePiPackage();
    const invocation = createHostedPiInvocation({
      packageRoot: fixture.root,
      cwd: fixture.project,
      sessionDir: fixture.sessionDir,
      model: 'fixture/model',
      thinking: 'off',
      credential: { provider: 'anthropic', key: 'anthropic-secret' },
    });

    assert.equal(invocation.command, process.execPath);
    assert.equal(invocation.args[0], fixture.entrypoint);
    assert.ok(invocation.args.includes('--mode'));
    assert.ok(invocation.args.includes('rpc'));
    for (const flag of [
      '--no-tools',
      '--no-extensions',
      '--no-skills',
      '--no-prompt-templates',
      '--no-themes',
      '--no-context-files',
      '--no-approve',
      '--offline',
    ]) assert.ok(invocation.args.includes(flag), `missing ${flag}`);
    assert.ok(invocation.args.includes('--session-dir'));
    assert.ok(invocation.args.includes(fixture.sessionDir));
    assert.ok(invocation.args.includes('--model'));
    assert.ok(invocation.args.includes('fixture/model'));
    assert.ok(invocation.args.includes('--thinking'));
    assert.ok(invocation.args.includes('off'));
    assert.equal(invocation.env.PATH, '');
    assert.equal(invocation.env.PI_OFFLINE, '1');
    assert.equal(invocation.env.PI_PACKAGE_DIR, undefined);
    assert.equal(invocation.env.PI_BIN, undefined);
    for (const key of ['npm_config_prefix', 'NPM_CONFIG_PREFIX', 'npm_execpath', 'npm_config_user_agent']) {
      assert.equal(invocation.env[key], undefined, `ambient package manager env leaked: ${key}`);
    }
    assert.equal(invocation.env.OD_TOOL_TOKEN, undefined);
    assert.equal(invocation.env.ANTHROPIC_API_KEY, 'anthropic-secret');
    assert.equal(invocation.env.AI_GATEWAY_API_KEY, undefined);
    assert.equal(invocation.args.includes('anthropic-secret'), false);
  });

  test('maps only the closed hosted provider credential into the child environment', () => {
    const fixture = fakePiPackage();
    const beforeAnthropic = process.env.ANTHROPIC_API_KEY;
    const beforeGateway = process.env.AI_GATEWAY_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'ambient-anthropic';
    process.env.AI_GATEWAY_API_KEY = 'ambient-gateway';
    try {
      const invocation = createHostedPiInvocation({
        packageRoot: fixture.root,
        cwd: fixture.project,
        sessionDir: fixture.sessionDir,
        credential: { provider: 'vercel-ai-gateway', key: 'gateway-secret' },
      });

      assert.equal(process.env.ANTHROPIC_API_KEY, 'ambient-anthropic');
      assert.equal(process.env.AI_GATEWAY_API_KEY, 'ambient-gateway');
      assert.equal(invocation.env.AI_GATEWAY_API_KEY, 'gateway-secret');
      assert.equal(invocation.env.ANTHROPIC_API_KEY, undefined);
      assert.equal(invocation.args.includes('gateway-secret'), false);
      assert.throws(() => createHostedPiInvocation({
        packageRoot: fixture.root,
        cwd: fixture.project,
        sessionDir: fixture.sessionDir,
        credential: { provider: 'anthropic', key: 'line\nbreak' },
      }), /credential/u);
      assert.throws(() => createHostedPiInvocation({
        packageRoot: fixture.root,
        cwd: fixture.project,
        sessionDir: fixture.sessionDir,
        credential: { provider: 'other' as never, key: 'secret' },
      }), /credential/u);
    } finally {
      if (beforeAnthropic == null) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = beforeAnthropic;
      if (beforeGateway == null) delete process.env.AI_GATEWAY_API_KEY;
      else process.env.AI_GATEWAY_API_KEY = beforeGateway;
    }
  });

  test('adds only the repository-owned broker extension when a server grant exists', async () => {
    const fixture = fakePiPackage();
    const broker = await createHostedPiBroker({
      runtimeRoot: fixture.root,
      binding: {
        userKey: 'user-a',
        runId: 'run-a',
        projectId: 'project-a',
        projectRoot: fixture.project,
      },
    });
    try {
      const invocation = createHostedPiInvocation({
        packageRoot: fixture.root,
        cwd: fixture.project,
        sessionDir: fixture.sessionDir,
        broker,
      });
      assert.ok(invocation.args.includes('--extension'));
      assert.ok(invocation.args.includes(broker.extensionPath));
      assert.ok(invocation.args.includes('--tools'));
      assert.ok(invocation.args.includes('od_hosted_broker'));
      assert.equal(invocation.env.OD_HOSTED_PI_BROKER_SOCKET, broker.socketPath);
      assert.equal(invocation.env.OD_HOSTED_PI_BROKER_TOKEN, broker.grant.token);
      assert.equal(invocation.env.ANTHROPIC_API_KEY, undefined);
      assert.equal(invocation.env.AI_GATEWAY_API_KEY, undefined);
    } finally {
      await broker.close();
    }
  });

  test('composes a server-owned broker with the package-local invocation', async () => {
    const fixture = fakePiPackage();
    const runtimeRoot = join(fixture.root, 'broker-runtime');
    const sessionRoot = join(fixture.root, 'broker-sessions');
    const request: HostedPiRuntimeRequest = {
      userKey: 'authenticated-user',
      runId: 'run-a',
      projectId: 'project-a',
      projectRoot: fixture.project,
      cwd: fixture.project,
      model: 'fixture/model',
      thinking: 'off',
      credential: { provider: 'vercel-ai-gateway', key: 'gateway-secret' },
    };
    const adapter = createHostedPiRuntimeAdapter({
      runtimeRoot,
      sessionRoot,
      packageRoot: fixture.root,
    });

    const handle = await adapter(request);
    try {
      assert.equal(handle.invocation.command, process.execPath);
      assert.equal(handle.invocation.env.OD_HOSTED_PI_BROKER_TOKEN?.startsWith('odpi_'), true);
      if (process.platform === 'win32') {
        assert.match(handle.invocation.env.OD_HOSTED_PI_BROKER_SOCKET ?? '', /OpenDesign\.HostedPi\./);
      } else {
        assert.match(handle.invocation.env.OD_HOSTED_PI_BROKER_SOCKET ?? '', /hosted-pi-/);
      }
      assert.equal(handle.invocation.sessionDir, join(sessionRoot, request.runId));
      assert.ok(handle.invocation.args.includes('--extension'));
      assert.equal(handle.invocation.args.includes('od_hosted_broker'), true);
      assert.equal(handle.invocation.env.AI_GATEWAY_API_KEY, 'gateway-secret');
    } finally {
      await handle.close?.();
    }
  });
});
