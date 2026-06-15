import { describe, expect, it, vi } from 'vitest';

import { cancelActiveConversationRuns } from '../src/project-routes.js';

describe('project rollback active run handling', () => {
  it('cancels active conversation runs instead of blocking rollback', () => {
    const activeRun = { id: 'run-1', status: 'running' };
    const cancel = vi.fn();
    const list = vi.fn(() => [activeRun]);

    const count = cancelActiveConversationRuns(
      { runs: { list, cancel } },
      'project-1',
      'conversation-1',
    );

    expect(count).toBe(1);
    expect(list).toHaveBeenCalledWith({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      status: 'active',
    });
    expect(cancel).toHaveBeenCalledWith(activeRun);
  });
});
