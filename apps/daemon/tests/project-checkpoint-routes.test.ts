import type http from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

describe('project checkpoint routes', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  async function createProject(prefix: string) {
    const projectId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const createResp = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: projectId, name: projectId, skillId: null, designSystemId: null }),
    });
    expect(createResp.status).toBe(200);
    const body = (await createResp.json()) as { conversationId: string };
    const messageId = (id: string) => `${projectId}-${id}`;
    return { projectId, conversationId: body.conversationId, messageId };
  }

  async function writeProjectText(projectId: string, name: string, content: string) {
    const response = await fetch(`${baseUrl}/api/projects/${projectId}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, content }),
    });
    expect(response.status).toBe(200);
  }

  async function saveMessage(
    projectId: string,
    conversationId: string,
    message: { id: string; role: 'user' | 'assistant'; content: string; telemetryFinalized?: boolean; runId?: string; runStatus?: string },
  ) {
    const response = await fetch(
      `${baseUrl}/api/projects/${projectId}/conversations/${conversationId}/messages/${message.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      },
    );
    expect(response.status).toBe(200);
  }

  async function messages(projectId: string, conversationId: string) {
    const response = await fetch(`${baseUrl}/api/projects/${projectId}/conversations/${conversationId}/messages`);
    expect(response.status).toBe(200);
    return ((await response.json()) as { messages: Array<{ id: string; content: string }> }).messages;
  }

  async function checkpoints(projectId: string, conversationId: string) {
    const response = await fetch(
      `${baseUrl}/api/projects/${projectId}/checkpoints?conversationId=${encodeURIComponent(conversationId)}`,
    );
    expect(response.status).toBe(200);
    return ((await response.json()) as { checkpoints: Array<{ id: string; messageId: string | null }> }).checkpoints;
  }

  it('rejects rollback when the target message is missing', async () => {
    const { projectId, conversationId } = await createProject('checkpoint-missing-target');

    const response = await fetch(`${baseUrl}/api/projects/${projectId}/conversations/${conversationId}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetMessageId: 'does-not-exist',
        mode: 'chat_only',
        conflictPolicy: 'fail',
        createSafetyCheckpoint: true,
      }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: 'MESSAGE_NOT_FOUND' },
    });
  });

  it('rejects project-bound /api/runs requests when checkpoint message binding is unavailable', async () => {
    const { projectId, conversationId } = await createProject('checkpoint-run-binding');
    const deleteConversation = await fetch(`${baseUrl}/api/projects/${projectId}/conversations/${conversationId}`, {
      method: 'DELETE',
    });
    expect(deleteConversation.status).toBe(200);

    const response = await fetch(`${baseUrl}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        agentId: 'codex',
        message: 'should not start without checkpoint coverage',
      }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'CHECKPOINT_CAPTURE_FAILED',
        message: expect.stringContaining('conversationId and assistantMessageId'),
      },
    });
  });

  it('rejects project-bound /api/chat requests when checkpoint message binding is unavailable', async () => {
    const { projectId } = await createProject('checkpoint-chat-binding');

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        agentId: 'codex',
        message: 'should not start without checkpoint coverage',
      }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'CHECKPOINT_CAPTURE_FAILED',
        message: expect.stringContaining('conversationId and assistantMessageId'),
      },
    });
  });

  it('rejects /api/runs when the supplied conversation belongs to another project', async () => {
    const first = await createProject('checkpoint-run-owner-a');
    const second = await createProject('checkpoint-run-owner-b');
    const assistantMessageId = first.messageId('assistant-cross-project');

    const response = await fetch(`${baseUrl}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: first.projectId,
        conversationId: second.conversationId,
        assistantMessageId,
        agentId: 'codex',
        message: 'must not start with a foreign conversation',
      }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'CHECKPOINT_CAPTURE_FAILED',
        message: expect.stringContaining('conversation does not belong to project'),
      },
    });
    expect((await messages(second.projectId, second.conversationId)).map((message) => message.id))
      .not.toContain(assistantMessageId);
  });

  it('rejects /api/chat when the supplied conversation belongs to another project', async () => {
    const first = await createProject('checkpoint-chat-owner-a');
    const second = await createProject('checkpoint-chat-owner-b');
    const assistantMessageId = first.messageId('assistant-cross-project');

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: first.projectId,
        conversationId: second.conversationId,
        assistantMessageId,
        agentId: 'codex',
        message: 'must not stream with a foreign conversation',
      }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'CHECKPOINT_CAPTURE_FAILED',
        message: expect.stringContaining('conversation does not belong to project'),
      },
    });
    expect((await messages(second.projectId, second.conversationId)).map((message) => message.id))
      .not.toContain(assistantMessageId);
  });

  it('restores files and prunes chat together, returning a before_restore safety checkpoint', async () => {
    const { projectId, conversationId, messageId } = await createProject('checkpoint-combined');
    const user1 = messageId('user-1');
    const assistant1 = messageId('assistant-1');
    const user2 = messageId('user-2');
    const assistant2 = messageId('assistant-2');

    await writeProjectText(projectId, 'index.html', '<h1>First</h1>');
    await saveMessage(projectId, conversationId, { id: user1, role: 'user', content: 'first' });
    await saveMessage(projectId, conversationId, {
      id: assistant1,
      role: 'assistant',
      content: 'first answer',
      runId: 'run-1',
      runStatus: 'succeeded',
      telemetryFinalized: true,
    });

    await writeProjectText(projectId, 'index.html', '<h1>Second</h1>');
    await writeProjectText(projectId, 'generated.html', '<p>new file</p>');
    await saveMessage(projectId, conversationId, { id: user2, role: 'user', content: 'second' });
    await saveMessage(projectId, conversationId, {
      id: assistant2,
      role: 'assistant',
      content: 'second answer',
      runId: 'run-2',
      runStatus: 'succeeded',
      telemetryFinalized: true,
    });

    const response = await fetch(`${baseUrl}/api/projects/${projectId}/conversations/${conversationId}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetMessageId: assistant1,
        mode: 'files_and_chat',
        conflictPolicy: 'fail',
        createSafetyCheckpoint: true,
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      projectId,
      conversationId,
      mode: 'files_and_chat',
      targetMessageId: assistant1,
      restoredCheckpointId: expect.any(String),
      safetyCheckpointId: expect.any(String),
      deletedMessageIds: [user2, assistant2],
      clearedAgentSessions: true,
      fileChanges: {
        modified: expect.any(Number),
        deleted: expect.any(Number),
      },
      conflicts: [],
    });

    const raw = await fetch(`${baseUrl}/api/projects/${projectId}/raw/index.html`);
    expect(await raw.text()).toBe('<h1>First</h1>');
    expect((await fetch(`${baseUrl}/api/projects/${projectId}/raw/generated.html`)).status).toBe(404);
    expect((await messages(projectId, conversationId)).map((message) => message.id)).toEqual([
      user1,
      assistant1,
    ]);
  });

  it('chat_only prunes messages without touching project files', async () => {
    const { projectId, conversationId, messageId } = await createProject('checkpoint-chat-only');
    const user1 = messageId('user-1');
    const assistant1 = messageId('assistant-1');
    const user2 = messageId('user-2');

    await writeProjectText(projectId, 'index.html', '<h1>Current</h1>');
    await saveMessage(projectId, conversationId, { id: user1, role: 'user', content: 'first' });
    await saveMessage(projectId, conversationId, {
      id: assistant1,
      role: 'assistant',
      content: 'first answer',
      telemetryFinalized: true,
    });
    await writeProjectText(projectId, 'index.html', '<h1>Must stay</h1>');
    await saveMessage(projectId, conversationId, { id: user2, role: 'user', content: 'second' });

    const response = await fetch(`${baseUrl}/api/projects/${projectId}/conversations/${conversationId}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetMessageId: assistant1,
        mode: 'chat_only',
        conflictPolicy: 'fail',
        createSafetyCheckpoint: true,
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      projectId,
      conversationId,
      mode: 'chat_only',
      safetyCheckpointId: expect.any(String),
      deletedMessageIds: [user2],
      clearedAgentSessions: true,
      fileChanges: { added: 0, modified: 0, deleted: 0 },
      conflicts: [],
    });
    const raw = await fetch(`${baseUrl}/api/projects/${projectId}/raw/index.html`);
    expect(await raw.text()).toBe('<h1>Must stay</h1>');
    expect((await messages(projectId, conversationId)).map((message) => message.id)).toEqual([
      user1,
      assistant1,
    ]);
  });

  it('rejects an invalid conflictPolicy without overwriting conflicted files', async () => {
    const { projectId, conversationId, messageId } = await createProject('checkpoint-invalid-policy');
    const assistant1 = messageId('assistant-1');

    await writeProjectText(projectId, 'index.html', '<h1>Checkpoint</h1>');
    await saveMessage(projectId, conversationId, {
      id: assistant1,
      role: 'assistant',
      content: 'first answer',
      telemetryFinalized: true,
    });
    await writeProjectText(projectId, 'index.html', '<h1>Dirty current</h1>');

    const response = await fetch(`${baseUrl}/api/projects/${projectId}/conversations/${conversationId}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetMessageId: assistant1,
        mode: 'files_only',
        conflictPolicy: 'overwrit',
        createSafetyCheckpoint: true,
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'BAD_REQUEST',
        message: 'invalid conflictPolicy',
      },
    });
    const raw = await fetch(`${baseUrl}/api/projects/${projectId}/raw/index.html`);
    expect(await raw.text()).toBe('<h1>Dirty current</h1>');
  });

  it('files_only restores files without pruning messages', async () => {
    const { projectId, conversationId, messageId } = await createProject('checkpoint-files-only');
    const user1 = messageId('user-1');
    const assistant1 = messageId('assistant-1');
    const user2 = messageId('user-2');

    await writeProjectText(projectId, 'index.html', '<h1>Before</h1>');
    await saveMessage(projectId, conversationId, { id: user1, role: 'user', content: 'first' });
    await saveMessage(projectId, conversationId, {
      id: assistant1,
      role: 'assistant',
      content: 'first answer',
      telemetryFinalized: true,
    });
    await writeProjectText(projectId, 'index.html', '<h1>After</h1>');
    await saveMessage(projectId, conversationId, { id: user2, role: 'user', content: 'second' });

    const response = await fetch(`${baseUrl}/api/projects/${projectId}/conversations/${conversationId}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetMessageId: assistant1,
        mode: 'files_only',
        conflictPolicy: 'overwrite',
        createSafetyCheckpoint: false,
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      projectId,
      conversationId,
      mode: 'files_only',
      safetyCheckpointId: expect.any(String),
      deletedMessageIds: [],
      clearedAgentSessions: false,
    });
    const raw = await fetch(`${baseUrl}/api/projects/${projectId}/raw/index.html`);
    expect(await raw.text()).toBe('<h1>Before</h1>');
    expect((await messages(projectId, conversationId)).map((message) => message.id)).toEqual([
      user1,
      assistant1,
      user2,
    ]);
  });

  it('rejects an explicit checkpoint id that belongs to a different target message', async () => {
    const { projectId, conversationId, messageId } = await createProject('checkpoint-mismatch');
    const assistant1 = messageId('assistant-1');
    const assistant2 = messageId('assistant-2');

    await writeProjectText(projectId, 'index.html', '<h1>First</h1>');
    await saveMessage(projectId, conversationId, {
      id: assistant1,
      role: 'assistant',
      content: 'first answer',
      telemetryFinalized: true,
    });
    await writeProjectText(projectId, 'index.html', '<h1>Second</h1>');
    await saveMessage(projectId, conversationId, {
      id: assistant2,
      role: 'assistant',
      content: 'second answer',
      telemetryFinalized: true,
    });
    const firstCheckpoint = (await checkpoints(projectId, conversationId))
      .find((checkpoint) => checkpoint.messageId === assistant1);
    expect(firstCheckpoint).toBeTruthy();

    const response = await fetch(`${baseUrl}/api/projects/${projectId}/conversations/${conversationId}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetMessageId: assistant2,
        targetCheckpointId: firstCheckpoint!.id,
        mode: 'files_and_chat',
        conflictPolicy: 'overwrite',
        createSafetyCheckpoint: true,
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: 'CHECKPOINT_MESSAGE_MISMATCH' },
    });
    expect((await messages(projectId, conversationId)).map((message) => message.id)).toEqual([
      assistant1,
      assistant2,
    ]);
  });

  it('returns ROLLBACK_CONFLICT for dirty current files when no baseline checkpoint exists', async () => {
    const { projectId, conversationId, messageId } = await createProject('checkpoint-no-baseline-conflict');
    const assistant1 = messageId('assistant-1');

    await writeProjectText(projectId, 'index.html', '<h1>First</h1>');
    await saveMessage(projectId, conversationId, {
      id: assistant1,
      role: 'assistant',
      content: 'first answer',
      telemetryFinalized: true,
    });
    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const filePath = path.join(dataDir, 'projects', projectId, 'index.html');
    await writeFile(filePath, '<h1>Human edit</h1>');

    const response = await fetch(`${baseUrl}/api/projects/${projectId}/conversations/${conversationId}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetMessageId: assistant1,
        mode: 'files_only',
        conflictPolicy: 'fail',
        createSafetyCheckpoint: true,
      }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'ROLLBACK_CONFLICT',
        conflicts: [expect.objectContaining({ path: 'index.html' })],
        safetyCheckpointId: expect.any(String),
      },
    });
    expect(await readFile(filePath, 'utf8')).toBe('<h1>Human edit</h1>');
  });

  it('returns ROLLBACK_CONFLICT without overwriting externally changed files', async () => {
    const { projectId, conversationId, messageId } = await createProject('checkpoint-conflict');
    const user1 = messageId('user-1');
    const assistant1 = messageId('assistant-1');
    const user2 = messageId('user-2');
    const assistant2 = messageId('assistant-2');

    await writeProjectText(projectId, 'index.html', '<h1>First</h1>');
    await saveMessage(projectId, conversationId, { id: user1, role: 'user', content: 'first' });
    await saveMessage(projectId, conversationId, {
      id: assistant1,
      role: 'assistant',
      content: 'first answer',
      telemetryFinalized: true,
    });
    await writeProjectText(projectId, 'index.html', '<h1>Agent second</h1>');
    await saveMessage(projectId, conversationId, { id: user2, role: 'user', content: 'second' });
    await saveMessage(projectId, conversationId, {
      id: assistant2,
      role: 'assistant',
      content: 'second answer',
      telemetryFinalized: true,
    });

    const dataDir = process.env.OD_DATA_DIR;
    if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');
    const filePath = path.join(dataDir, 'projects', projectId, 'index.html');
    await writeFile(filePath, '<h1>Human edit</h1>');

    const response = await fetch(`${baseUrl}/api/projects/${projectId}/conversations/${conversationId}/rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetMessageId: assistant1,
        mode: 'files_and_chat',
        conflictPolicy: 'fail',
        createSafetyCheckpoint: true,
      }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'ROLLBACK_CONFLICT',
        conflicts: [expect.objectContaining({ path: 'index.html' })],
      },
    });
    expect(await readFile(filePath, 'utf8')).toBe('<h1>Human edit</h1>');
    expect((await messages(projectId, conversationId)).map((message) => message.id)).toEqual([
      user1,
      assistant1,
      user2,
      assistant2,
    ]);
    await expect(stat(filePath)).resolves.toMatchObject({});
  });
});
