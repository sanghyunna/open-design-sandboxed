import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, test } from 'vitest';
import {
  createHostedPiInvocation,
  resolveHostedPiEntrypoint,
} from '../src/runtimes/hosted-pi-runtime.js';
import { createHostedPiBroker } from '../src/runtimes/hosted-pi-broker.js';

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
    } finally {
      await broker.close();
    }
  });

  test('rejects project-controlled extension paths', () => {
    const fixture = fakePiPackage();
    const extension = join(fixture.project, 'project-extension.ts');
    writeFileSync(extension, 'export default () => undefined;');
    assert.throws(
      () => createHostedPiInvocation({
        packageRoot: fixture.root,
        cwd: fixture.project,
        sessionDir: fixture.sessionDir,
        extensions: [extension],
      }),
      /repository-owned/i,
    );
  });
});
