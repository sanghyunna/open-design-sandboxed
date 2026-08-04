import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, test } from 'vitest';
import {
  createHostedPiInvocation,
  resolveHostedPiEntrypoint,
} from '../src/runtimes/hosted-pi-runtime.js';

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
      /package-local|entrypoint|pinned/i,
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
});
