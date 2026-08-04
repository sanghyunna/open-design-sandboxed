import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
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
    mkdirSync(siblingProject, { recursive: true });
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
    const systemRoot = process.platform === 'win32' ? process.env.SystemRoot : '/etc';
    if (!systemRoot) return;
    await assert.rejects(
      () => createHostedPiBroker({ binding: { ...f.binding, projectRoot: systemRoot }, runtimeRoot: f.root }),
      /system path/i,
    );
    await assert.rejects(
      () => createHostedPiBroker({ binding: f.binding, runtimeRoot: systemRoot }),
      /system path/i,
    );
  });
});
