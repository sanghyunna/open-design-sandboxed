import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import {
  createHostedEventBudget,
  createHostedEventJournal,
} from '../src/hosted-event-journal.js';

describe('hosted durable event journal milestones', () => {
  it('keeps a prepared milestone and its cursor invisible until commit', () => {
    const budget = createHostedEventBudget();
    const journal = createHostedEventJournal({
      budget,
      generation: 'generation-one',
      ownerKey: 'owner-a',
      secret: Buffer.alloc(32, 1),
    });
    const channel = { kind: 'run' as const, runId: 'run-1' };
    const transient = journal.publish(channel, 'run.progress', { delta: 'one' });
    const live = new FakeResponse();
    journal.attach({ ownerKey: 'owner-a', channel, response: live });
    const before = budget.snapshot();

    const prepared = journal.prepareDurable(
      channel,
      'run.status',
      { runId: 'run-1', status: 'running' },
      'status-transition',
    );

    expect(budget.snapshot()).toEqual(before);
    expect(journal.replay({ ownerKey: 'owner-a', channel })).toEqual({
      kind: 'events',
      events: [transient],
    });
    expect(live.writes).toHaveLength(1);
    expect(() => journal.publish(channel, 'run.progress', { delta: 'two' })).toThrow(
      'hosted durable event is awaiting commit',
    );
    expect(prepared.snapshot.events).toMatchObject([
      { event: 'run.status', milestone: 'status-transition', sequence: 2 },
    ]);

    prepared.rollback();
    const retried = journal.prepareDurable(
      channel,
      'run.status',
      { runId: 'run-1', status: 'running' },
      'status-transition',
    );
    expect(retried.record.cursor).toBe(prepared.record.cursor);
    retried.commit();
    expect(budget.snapshot().events).toBe(2);
    expect(journal.replay({ ownerKey: 'owner-a', channel, after: transient.cursor })).toEqual({
      kind: 'events',
      events: [retried.record],
    });
    expect(live.writes.at(-1)).toContain('event: run.status');
    journal.dispose();
  });

  it('restores only durable milestones with monotonic sequences and resyncs an omitted transient suffix', () => {
    const budget = createHostedEventBudget();
    const source = createHostedEventJournal({
      budget,
      generation: 'generation-one',
      ownerKey: 'owner-a',
      secret: Buffer.alloc(32, 2),
    });
    const channel = { kind: 'run' as const, runId: 'run-1' };
    source.prepareDurable(
      channel,
      'run.created',
      { runId: 'run-1', status: 'queued' },
      'run-created',
    ).commit();
    const transient = source.publish(channel, 'run.progress', { delta: 'not durable' });
    const terminal = source.prepareDurable(
      channel,
      'run.finished',
      { runId: 'run-1', status: 'succeeded' },
      'terminal',
    );
    const snapshot = terminal.snapshot;
    terminal.commit();
    source.dispose();

    expect(snapshot.events.map(({ event, sequence }) => ({ event, sequence }))).toEqual([
      { event: 'run.created', sequence: 1 },
      { event: 'run.finished', sequence: 3 },
    ]);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('not durable');
    expect(serialized).not.toContain('owner-a');
    expect(serialized).not.toContain('generation-one');

    const restored = createHostedEventJournal({
      budget,
      generation: 'generation-two',
      ownerKey: 'owner-a',
      restore: snapshot,
      secret: Buffer.alloc(32, 9),
    });
    expect(restored.replay({ ownerKey: 'owner-a', channel, after: transient.cursor })).toEqual({
      kind: 'resync',
      reason: 'generation-expired',
    });
    expect(restored.replay({ ownerKey: 'owner-b', channel })).toEqual({ kind: 'not-owned' });
    const replay = restored.replay({ ownerKey: 'owner-a', channel });
    expect(replay).toMatchObject({
      kind: 'events',
      events: [
        { event: 'run.created' },
        { event: 'run.finished' },
      ],
    });
    const next = restored.publish({ kind: 'owner' }, 'owner.updated', { ok: true });
    expect(next.cursor.split('.')[1]).toBe('4');

    const response = new FakeResponse();
    restored.attach({ ownerKey: 'owner-a', channel, response });
    expect(response.writableEnded).toBe(true);
    restored.dispose();
  });

  it('rotates the generation on restore and rejects a copied owner snapshot', () => {
    const budget = createHostedEventBudget();
    const source = createHostedEventJournal({
      budget,
      generation: 'generation-one',
      ownerKey: 'owner-a',
      secret: Buffer.alloc(32, 3),
    });
    const channel = { kind: 'run' as const, runId: 'run-1' };
    const prepared = source.prepareDurable(
      channel,
      'run.created',
      { runId: 'run-1', status: 'queued' },
      'run-created',
    );
    const oldCursor = prepared.record.cursor;
    prepared.commit();
    source.dispose();

    expect(() => createHostedEventJournal({
      budget,
      generation: 'generation-one',
      ownerKey: 'owner-a',
      restore: prepared.snapshot,
    })).toThrow('hosted event journal snapshot is invalid');
    expect(() => createHostedEventJournal({
      budget,
      generation: 'generation-two',
      ownerKey: 'owner-b',
      restore: prepared.snapshot,
    })).toThrow('hosted event journal snapshot is invalid');

    const restored = createHostedEventJournal({
      budget,
      generation: 'generation-two',
      ownerKey: 'owner-a',
      restore: prepared.snapshot,
    });
    expect(restored.replay({ ownerKey: 'owner-a', channel, after: oldCursor })).toEqual({
      kind: 'resync',
      reason: 'generation-expired',
    });
    const replay = restored.replay({ ownerKey: 'owner-a', channel });
    expect(replay.kind).toBe('events');
    if (replay.kind === 'events') expect(replay.events[0]?.cursor).not.toBe(oldCursor);
    restored.dispose();
  });

  it('makes durable resync visible only after commit and rejects secret or absolute-path payloads', () => {
    const budget = createHostedEventBudget();
    const journal = createHostedEventJournal({
      budget,
      generation: 'generation-one',
      ownerKey: 'owner-a',
    });
    const channel = { kind: 'project' as const, projectId: 'project-1' };
    const first = journal.publish(channel, 'project.updated', { revision: 1 });
    const live = new FakeResponse();
    journal.attach({ ownerKey: 'owner-a', channel, response: live });
    const prepared = journal.prepareDurable(
      channel,
      'resync',
      { reason: 'cursor-expired' },
      'resync',
    );

    expect(live.writableEnded).toBe(false);
    expect(journal.replay({ ownerKey: 'owner-a', channel, after: first.cursor })).toEqual({
      kind: 'events',
      events: [],
    });
    prepared.commit();
    expect(live.writes.at(-1)).toContain('event: resync');
    expect(live.writableEnded).toBe(true);
    expect(journal.replay({ ownerKey: 'owner-a', channel, after: first.cursor })).toEqual({
      kind: 'resync',
      reason: 'cursor-expired',
    });

    expect(() => journal.prepareDurable(
      { kind: 'run', runId: 'run-2' },
      'run.created',
      { apiKey: 'do-not-persist' },
      'run-created',
    )).toThrow('credential material');
    expect(() => journal.prepareDurable(
      { kind: 'run', runId: 'run-2' },
      'run.created',
      { source: 'C:\\private\\session.jsonl' },
      'run-created',
    )).toThrow('absolute path');
    journal.dispose();
  });

  it('reserves global journal capacity without exposing prepared accounting', () => {
    const budget = createHostedEventBudget({ maxEvents: 2, maxBytes: 10_000 });
    const ownerA = createHostedEventJournal({
      budget,
      generation: 'generation-one',
      ownerKey: 'owner-a',
    });
    const ownerB = createHostedEventJournal({
      budget,
      generation: 'generation-one',
      ownerKey: 'owner-b',
    });
    ownerA.publish({ kind: 'owner' }, 'owner.updated', { revision: 1 });
    const prepared = ownerA.prepareDurable(
      { kind: 'owner' },
      'owner.status',
      { status: 'ready' },
      'status-transition',
    );

    expect(budget.snapshot().events).toBe(1);
    expect(() => ownerB.publish({ kind: 'owner' }, 'owner.updated', { revision: 1 })).toThrowError(
      expect.objectContaining({ code: 'HOSTED_CAPACITY_EXHAUSTED' }),
    );
    prepared.commit();
    expect(budget.snapshot().events).toBe(2);
    ownerA.dispose();
    ownerB.dispose();
  });
});

class FakeResponse extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  writes: string[] = [];

  write(chunk: string): boolean {
    this.writes.push(chunk);
    return true;
  }

  end(): void {
    if (this.writableEnded) return;
    this.writableEnded = true;
    this.emit('finish');
  }
}
