import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, test } from 'vitest';
import {
  createHostedPiBroker,
  type HostedPiBinding,
} from '../src/runtimes/hosted-pi-broker.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): { root: string; project: string; binding: HostedPiBinding } {
  const root = mkdtempSync(join(tmpdir(), 'od-hosted-pi-broker-'));
  roots.push(root);
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, 'index.html'), '<h1>safe</h1>');
  return {
    root,
    project,
    binding: {
      userKey: 'user-a',
      runId: 'run-a',
      projectId: 'project-a',
      projectRoot: project,
    },
  };
}

describe('hosted Pi broker', () => {
  test('binds every grant to its server-owned user, run, project, and fixed operations', async () => {
    const f = fixture();
    const broker = await createHostedPiBroker({ binding: f.binding, runtimeRoot: f.root });
    try {
      const write = await broker.invoke({
        token: broker.grant.token,
        operation: 'project:file:write',
        path: 'new.txt',
        content: 'created through the broker',
      });
      assert.equal(write.ok, true);
      const read = await broker.invoke({
        token: broker.grant.token,
        operation: 'project:file:read',
        path: 'new.txt',
      });
      assert.deepEqual(read, {
        ok: true,
        operation: 'project:file:read',
        content: 'created through the broker',
      });
      const list = await broker.invoke({
        token: broker.grant.token,
        operation: 'project:file:list',
        path: '',
      });
      assert.equal(list.ok, true);
      assert.equal(list.entries?.includes('index.html'), true);
      writeFileSync(join(f.project, 'external.txt'), 'created outside the broker');
      const stableList = await broker.invoke({
        token: broker.grant.token,
        operation: 'project:file:list',
        path: '',
      });
      assert.equal(stableList.ok, true);
      assert.equal(stableList.entries?.includes('external.txt'), false);

      for (const mismatch of [
        { userKey: 'user-b' },
        { runId: 'run-b' },
        { projectId: 'project-b' },
        { projectRoot: join(f.root, 'sibling-project') },
      ]) {
        const denied = await broker.invoke(
          { token: broker.grant.token, operation: 'project:file:read', path: 'index.html' },
          { ...f.binding, ...mismatch },
        );
        assert.equal(denied.ok, false);
      }

      for (const operation of ['process:spawn', 'filesystem:read', 'environment:read']) {
        const denied = await broker.invoke({ token: broker.grant.token, operation, path: 'index.html' });
        assert.equal(denied.ok, false, operation);
      }
    } finally {
      await broker.close();
    }
  });

  test('rejects traversal, absolute paths, links, and sibling roots', async () => {
    const f = fixture();
    const sibling = join(f.root, 'sibling.txt');
    const siblingProject = join(f.root, 'sibling-project');
    const nested = join(f.project, 'nested');
    mkdirSync(siblingProject, { recursive: true });
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'index.html'), 'nested');
    writeFileSync(sibling, 'private');
    const link = join(f.project, 'outside.txt');
    const linkedDirectory = join(f.project, 'outside-directory');
    let linkedDirectoryCreated = false;
    try {
      symlinkSync(sibling, link, 'file');
      symlinkSync(siblingProject, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');
      linkedDirectoryCreated = true;
    } catch {
      // Link creation is unavailable on some Windows CI accounts; the
      // absolute/traversal assertions still exercise the boundary there.
    }
    const broker = await createHostedPiBroker({ binding: f.binding, runtimeRoot: f.root });
    try {
      for (const path of ['../sibling.txt', sibling, 'C:\\Windows\\system.ini', '/etc/passwd', 'outside.txt']) {
        const denied = await broker.invoke({ token: broker.grant.token, operation: 'project:file:read', path });
        assert.equal(denied.ok, false, path);
      }
      for (const operation of ['project:file:list', 'project:file:read', 'project:file:write'] as const) {
        const denied = await broker.invoke({
          token: broker.grant.token,
          operation,
          path: 'nested/index.html',
          ...(operation === 'project:file:write' ? { content: 'nope' } : {}),
        });
        assert.equal(denied.ok, false, operation);
      }
      const nestedListing = await broker.invoke({
        token: broker.grant.token,
        operation: 'project:file:list',
        path: 'nested',
      });
      assert.equal(nestedListing.ok, false);
      if (linkedDirectoryCreated) {
        for (const operation of ['project:file:list', 'project:file:write'] as const) {
          const denied = await broker.invoke({
            token: broker.grant.token,
            operation,
            path: 'outside-directory/escape.txt',
            ...(operation === 'project:file:write' ? { content: 'nope' } : {}),
          });
          assert.equal(denied.ok, false, operation);
        }
      }
    } finally {
      await broker.close();
    }
  });

  test('rejects system project and runtime roots', async () => {
    const f = fixture();
    const systemRoots = process.platform === 'win32'
      ? [
          process.env.SystemRoot,
          process.env.ProgramFiles,
          process.env['ProgramFiles(x86)'],
          process.env.ProgramData,
          process.env.CommonProgramFiles,
          process.env['CommonProgramFiles(x86)'],
          process.env.CommonProgramW6432,
        ]
      : ['/etc', '/proc', '/sys', '/dev', '/usr', '/var', '/root', '/run'];
    for (const systemRoot of systemRoots.filter((value): value is string => Boolean(value))) {
      await assert.rejects(
        () => createHostedPiBroker({ binding: { ...f.binding, projectRoot: systemRoot }, runtimeRoot: f.root }),
        /system path/i,
      );
      await assert.rejects(
        () => createHostedPiBroker({ binding: f.binding, runtimeRoot: systemRoot }),
        /system path/i,
      );
    }
  });

  test('rejects a project root that is itself a symlink or junction', async () => {
    const f = fixture();
    const linkedRoot = join(f.root, 'linked-project-root');
    try {
      symlinkSync(f.project, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }
    await assert.rejects(
      () => createHostedPiBroker({
        binding: { ...f.binding, projectRoot: linkedRoot },
        runtimeRoot: f.root,
      }),
      /symlink|junction/i,
    );
  });

  test('denies a grant after its project root is replaced by a link', async () => {
    const f = fixture();
    const broker = await createHostedPiBroker({ binding: f.binding, runtimeRoot: f.root });
    const moved = join(f.root, 'moved-project');
    try {
      renameSync(f.project, moved);
      try {
        symlinkSync(moved, f.project, process.platform === 'win32' ? 'junction' : 'dir');
      } catch {
        return;
      }
      const denied = await broker.invoke({
        token: broker.grant.token,
        operation: 'project:file:write',
        path: 'escape.txt',
        content: 'nope',
      });
      assert.equal(denied.ok, false);
    } finally {
      await broker.close();
    }
  });

  test('denies a grant after its project root is replaced by another directory', async () => {
    const f = fixture();
    const broker = await createHostedPiBroker({ binding: f.binding, runtimeRoot: f.root });
    const moved = join(f.root, 'moved-project');
    try {
      renameSync(f.project, moved);
      mkdirSync(f.project, { recursive: true });
      const denied = await broker.invoke({
        token: broker.grant.token,
        operation: 'project:file:write',
        path: 'escape.txt',
        content: 'nope',
      });
      assert.equal(denied.ok, false);
    } finally {
      await broker.close();
    }
  });
});
