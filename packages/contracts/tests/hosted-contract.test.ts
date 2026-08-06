import { describe, expect, it } from 'vitest';

import {
  HOSTED_AG_UI_EVENT_KINDS,
  HOSTED_GEN_UI_SURFACE_KINDS,
  HOSTED_PROJECT_KINDS,
  HOSTED_RUN_STATUSES,
  type HostedDesignSystemReadV1,
  type HostedProjectCreateV1,
  type HostedRunCreateV1,
} from '../src/api/hosted.js';
import { API_ERROR_CODES } from '../src/errors.js';

describe('hosted PR07 contracts', () => {
  it('freezes the hosted project, run, GenUI, and AG-UI enums', () => {
    expect(HOSTED_PROJECT_KINDS).toEqual(['prototype', 'deck', 'template', 'other']);
    expect(HOSTED_RUN_STATUSES).toEqual([
      'queued',
      'running',
      'succeeded',
      'failed',
      'canceled',
    ]);
    expect(HOSTED_GEN_UI_SURFACE_KINDS).toEqual([
      'form',
      'choice',
      'confirmation',
      'oauth-prompt',
    ]);
    expect(HOSTED_AG_UI_EVENT_KINDS).toEqual([
      'agent.message',
      'tool_call',
      'state_update',
      'ui.surface_requested',
      'ui.surface_responded',
      'run.lifecycle',
    ]);
  });

  it('keeps authority-bearing hosted request shapes closed', () => {
    const project: HostedProjectCreateV1 = { title: 'Prototype', kind: 'prototype' };
    const run: HostedRunCreateV1 = {
      projectId: 'project-1',
      conversationId: 'conversation-1',
      assistantMessageId: 'message-1',
      agentId: 'pi',
      message: 'Build it',
      clientRequestId: 'retry-1',
    };
    const designSystemRead: HostedDesignSystemReadV1 = { path: 'tokens/colors.json' };
    // @ts-expect-error Hosted projects never accept a filesystem root.
    const projectWithRoot: HostedProjectCreateV1 = { title: 'Unsafe', baseDir: 'C:\\outside' };
    // @ts-expect-error Hosted runs never accept a client tool bundle.
    const runWithTools: HostedRunCreateV1 = { ...run, toolBundle: { servers: [] } };
    // @ts-expect-error Broker grants are server-minted, never request fields.
    const readWithGrant: HostedDesignSystemReadV1 = { ...designSystemRead, grant: 'copied' };

    expect(project).toEqual({ title: 'Prototype', kind: 'prototype' });
    expect(run.clientRequestId).toBe('retry-1');
    expect(designSystemRead.path).toBe('tokens/colors.json');
    expect(projectWithRoot).toHaveProperty('baseDir');
    expect(runWithTools).toHaveProperty('toolBundle');
    expect(readWithGrant).toHaveProperty('grant');
  });

  it('publishes the PR07 cursor-expiry failure', () => {
    expect(API_ERROR_CODES).toContain('CURSOR_EXPIRED');
  });
});
