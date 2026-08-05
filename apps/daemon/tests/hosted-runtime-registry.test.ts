import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiError } from '@open-design/contracts';
import {
  createHostedRuntimeRegistry,
  HostedRuntimeError,
  type HostedRuntimeRegistryOptions,
} from '../src/hosted-runtime-registry.js';
import { statusForError } from '../src/http/response.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function expectHostedCode(error: unknown, code: string): boolean {
  expect(error).toBeInstanceOf(HostedRuntimeError);
  expect((error as HostedRuntimeError).code).toBe(code);
  return true;
}

function expectHostedThrow(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expectHostedCode(error, code);
    return;
  }
  throw new Error(`expected ${code}`);
}

function createRegistry(
  overrides: Partial<HostedRuntimeRegistryOptions> = {},
) {
  return createHostedRuntimeRegistry({
    runtimeRoot: join(tmpdir(), 'od-hosted-runtime-registry-tests'),
    ...overrides,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('HostedRuntimeRegistry', () => {
  it('serializes one user FIFO while different users overlap', async () => {
    const registry = createRegistry();
    const a = registry.acquire({ userKey: 'a' });
    const b = registry.acquire({ userKey: 'b' });
    const a1Started = deferred();
    const a2Started = deferred();
    const b1Started = deferred();
    const releaseA1 = deferred();
    const releaseB1 = deferred();
    const order: string[] = [];

    const a1 = registry.dispatch(a, {
      conversationId: 'conversation-a',
      runId: 'a1',
      execute: async () => {
        order.push('a1:start');
        a1Started.resolve();
        await releaseA1.promise;
        order.push('a1:end');
        return { value: 'a1' };
      },
    });
    const a2 = registry.dispatch(a, {
      conversationId: 'conversation-a',
      runId: 'a2',
      execute: async () => {
        order.push('a2:start');
        a2Started.resolve();
        return { value: 'a2' };
      },
    });
    const b1 = registry.dispatch(b, {
      conversationId: 'conversation-b',
      runId: 'b1',
      execute: async () => {
        order.push('b1:start');
        b1Started.resolve();
        await releaseB1.promise;
        return { value: 'b1' };
      },
    });

    await Promise.all([a1Started.promise, b1Started.promise]);
    expect(order).not.toContain('a2:start');
    releaseA1.resolve();
    await a2Started.promise;
    releaseB1.resolve();
    await expect(Promise.all([a1, a2, b1])).resolves.toEqual(['a1', 'a2', 'b1']);
    expect(order.indexOf('a1:end')).toBeLessThan(order.indexOf('a2:start'));

    a.release();
    b.release();
    await registry.shutdown();
  });

  it('returns deterministic typed errors for per-user and global admission limits', async () => {
    const registry = createRegistry({
      limits: { queuedMutationsPerUser: 1, residentRuntimes: 1 },
    });
    const a = registry.acquire({ userKey: 'a' });
    const release = deferred();
    const started = deferred();
    const a1 = registry.dispatch(a, {
      conversationId: 'c',
      runId: 'a1',
      execute: async () => {
        started.resolve();
        await release.promise;
        return { value: undefined };
      },
    });
    await started.promise;
    const a2 = registry.dispatch(a, {
      conversationId: 'c',
      runId: 'a2',
      execute: async () => ({ value: undefined }),
    });

    await expect(registry.dispatch(a, {
      conversationId: 'c',
      runId: 'a3',
      execute: async () => ({ value: undefined }),
    })).rejects.toSatisfy((error: unknown) => expectHostedCode(error, 'HOSTED_OVERLOADED'));
    expectHostedThrow(
      () => registry.acquire({ userKey: 'b' }),
      'HOSTED_CAPACITY_EXHAUSTED',
    );

    release.resolve();
    await Promise.all([a1, a2]);
    a.release();
    await registry.shutdown();

    vi.useFakeTimers();
    const childLimited = createRegistry({
      admissionTimeoutMs: 20,
      limits: { activeChildren: 1 },
    });
    const childA = childLimited.acquire({ userKey: 'a' });
    const childB = childLimited.acquire({ userKey: 'b' });
    const childStarted = deferred();
    const releaseChild = deferred();
    const active = childLimited.dispatch(childA, {
      conversationId: 'c',
      runId: 'active',
      execute: async () => {
        childStarted.resolve();
        await releaseChild.promise;
        return { value: undefined };
      },
    });
    await childStarted.promise;
    const waiting = childLimited.dispatch(childB, {
      conversationId: 'c',
      runId: 'waiting',
      execute: async () => ({ value: undefined }),
    });
    const waitingExpectation = expect(waiting).rejects.toSatisfy(
      (error: unknown) => expectHostedCode(error, 'HOSTED_CAPACITY_EXHAUSTED'),
    );
    await vi.advanceTimersByTimeAsync(20);
    await waitingExpectation;
    releaseChild.resolve();
    await active;
    childA.release();
    childB.release();
    await childLimited.shutdown();

    const bindingLimited = createRegistry({
      idleEvictionMs: 1,
      limits: { identityBindings: 1 },
    });
    const bound = bindingLimited.acquire({ userKey: 'a' });
    bound.release();
    await vi.advanceTimersByTimeAsync(1);
    expectHostedThrow(
      () => bindingLimited.acquire({ userKey: 'b' }),
      'HOSTED_CAPACITY_EXHAUSTED',
    );
    await bindingLimited.shutdown();
  });

  it('does not allow test or composition options to raise frozen limits', () => {
    expect(() => createRegistry({
      limits: { activeChildren: 33 },
    })).toThrow(/fixed maximum/u);
    expect(() => createRegistry({
      runTimeoutMs: 30 * 60_000 + 1,
    })).toThrow(/fixed maximum/u);
  });

  it.each([
    ['HOSTED_OVERLOADED', 429],
    ['HOSTED_CAPACITY_EXHAUSTED', 503],
    ['HOSTED_QUOTA_EXCEEDED', 413],
    ['HOSTED_RUNTIME_UNAVAILABLE', 503],
    ['HOSTED_RUN_CANCELED', 409],
    ['HOSTED_RUN_TIMED_OUT', 504],
    ['HOSTED_SHUTDOWN_TIMEOUT', 504],
  ] as const)('maps %s to HTTP %i', (code, status) => {
    expect(statusForError(createApiError(code, 'test'))).toBe(status);
  });

  it('keeps verified session references distinct by conversation', async () => {
    const registry = createRegistry();
    const lease = registry.acquire({ userKey: 'a' });
    const seen: Array<string | null> = [];
    const run = (runId: string, conversationId: string, sessionReference: string) =>
      registry.dispatch(lease, {
        conversationId,
        runId,
        execute: async ({ sessionReference: previous }) => {
          seen.push(previous);
          return { sessionReference, value: runId };
        },
      });

    await run('a1', 'conversation-1', 'session-1');
    await run('a2', 'conversation-2', 'session-2');
    await run('a3', 'conversation-1', 'session-1-next');
    await run('a4', 'conversation-2', 'session-2-next');
    expect(seen).toEqual([null, null, 'session-1', 'session-2']);

    lease.release();
    await registry.shutdown();
  });

  it('bounds retained session references before admitting another conversation', async () => {
    const registry = createRegistry({
      limits: {
        sessionReferenceBytesPerUser: 4,
        sessionReferencesPerUser: 1,
      },
    });
    const lease = registry.acquire({ userKey: 'a' });
    await registry.dispatch(lease, {
      conversationId: 'conversation-1',
      runId: 'a1',
      execute: async () => ({ sessionReference: '1234', value: undefined }),
    });
    let executed = false;
    await expect(registry.dispatch(lease, {
      conversationId: 'conversation-2',
      runId: 'a2',
      execute: async () => {
        executed = true;
        return { sessionReference: 'x', value: undefined };
      },
    })).rejects.toSatisfy(
      (error: unknown) => expectHostedCode(error, 'HOSTED_QUOTA_EXCEEDED'),
    );
    expect(executed).toBe(false);
    await expect(registry.dispatch(lease, {
      conversationId: 'conversation-1',
      runId: 'a3',
      execute: async () => ({ sessionReference: '12345', value: undefined }),
    })).rejects.toSatisfy(
      (error: unknown) => expectHostedCode(error, 'HOSTED_QUOTA_EXCEEDED'),
    );
    await expect(registry.dispatch(lease, {
      conversationId: 'conversation-1',
      runId: 'a4',
      execute: async ({ sessionReference }) => ({ value: sessionReference }),
    })).resolves.toBe('1234');

    lease.release();
    await registry.shutdown();
  });

  it('releases the lane after cancellation, timeout, and child crash', async () => {
    vi.useFakeTimers();
    const registry = createRegistry({ runTimeoutMs: 50 });
    const lease = registry.acquire({ userKey: 'a' });
    const cancelStarted = deferred();
    const cancelRun = registry.dispatch(lease, {
      conversationId: 'c',
      runId: 'cancel',
      execute: ({ signal }) => new Promise<{ value: string }>((resolve) => {
        cancelStarted.resolve();
        signal.addEventListener('abort', () => resolve({ value: 'ignored' }), { once: true });
      }),
    });
    await cancelStarted.promise;
    expect(registry.cancel({
      generation: lease.generation,
      runId: 'cancel',
      userKey: lease.userKey,
    }, 'user_requested')).toBe(true);
    await expect(cancelRun).rejects.toSatisfy(
      (error: unknown) => expectHostedCode(error, 'HOSTED_RUN_CANCELED'),
    );
    await expect(registry.dispatch(lease, {
      conversationId: 'c',
      runId: 'after-cancel',
      execute: async () => ({ value: 'after-cancel' }),
    })).resolves.toBe('after-cancel');

    const timeoutRun = registry.dispatch(lease, {
      conversationId: 'c',
      runId: 'timeout',
      execute: ({ signal }) => new Promise<{ value: string }>((resolve) => {
        signal.addEventListener('abort', () => resolve({ value: 'ignored' }), { once: true });
      }),
    });
    const timeoutExpectation = expect(timeoutRun).rejects.toSatisfy(
      (error: unknown) => expectHostedCode(error, 'HOSTED_RUN_TIMED_OUT'),
    );
    await vi.advanceTimersByTimeAsync(50);
    await timeoutExpectation;

    await expect(registry.dispatch(lease, {
      conversationId: 'c',
      runId: 'crash',
      execute: async () => { throw new Error('child crashed'); },
    })).rejects.toThrow('child crashed');
    await expect(registry.dispatch(lease, {
      conversationId: 'c',
      runId: 'after-crash',
      execute: async () => ({ value: 'after-crash' }),
    })).resolves.toBe('after-crash');

    lease.release();
    await registry.shutdown();
  });

  it('binds identities injectively and derives path-safe storage keys', async () => {
    const registry = createRegistry();
    const first = registry.acquire({ userKey: 'issuer\u0000subject/../A' });
    expect(first.storageKey).toMatch(/^od1_[0-9a-f]{64}$/u);
    first.release();
    await registry.shutdown();

    const colliding = createRegistry({ deriveStorageKey: () => `od1_${'0'.repeat(64)}` });
    const a = colliding.acquire({ userKey: 'a' });
    expectHostedThrow(
      () => colliding.acquire({ userKey: 'b' }),
      'HOSTED_AUTH_INVALID',
    );
    a.release();
    await colliding.shutdown();
  });

  it('strong leases block eviction, weak leases do not, and stale controls miss recreated runtimes', async () => {
    vi.useFakeTimers();
    const registry = createRegistry({ idleEvictionMs: 25 });
    const strong = registry.acquire({ userKey: 'a' });
    const weak = registry.acquire({ userKey: 'a' }, 'weak');
    const firstGeneration = strong.generation;

    await vi.advanceTimersByTimeAsync(100);
    const stillLive = registry.acquire({ userKey: 'a' });
    expect(stillLive.generation).toBe(firstGeneration);
    strong.release();
    stillLive.release();
    await vi.advanceTimersByTimeAsync(25);

    const recreated = registry.acquire({ userKey: 'a' });
    expect(recreated.generation).toBeGreaterThan(firstGeneration);
    expect(registry.cancel({
      generation: firstGeneration,
      runId: 'same-run-id',
      userKey: 'a',
    })).toBe(false);

    weak.release();
    recreated.release();
    await registry.shutdown();
  });

  it('shutdown cancels work, rejects queued turns, and waits for strong leases', async () => {
    const registry = createRegistry();
    const lease = registry.acquire({ userKey: 'a' });
    const started = deferred();
    const active = registry.dispatch(lease, {
      conversationId: 'c',
      runId: 'active',
      execute: ({ signal }) => new Promise<{ value: string }>((resolve) => {
        started.resolve();
        signal.addEventListener('abort', () => resolve({ value: 'ignored' }), { once: true });
      }),
    });
    await started.promise;
    const queued = registry.dispatch(lease, {
      conversationId: 'c',
      runId: 'queued',
      execute: async () => ({ value: 'never' }),
    });
    let shutdownFinished = false;
    const shutdown = registry.shutdown().then(() => { shutdownFinished = true; });

    await expect(active).rejects.toSatisfy(
      (error: unknown) => expectHostedCode(error, 'HOSTED_RUN_CANCELED'),
    );
    await expect(queued).rejects.toSatisfy(
      (error: unknown) => expectHostedCode(error, 'HOSTED_RUN_CANCELED'),
    );
    await Promise.resolve();
    expect(shutdownFinished).toBe(false);
    lease.release();
    await shutdown;
    expectHostedThrow(
      () => registry.acquire({ userKey: 'a' }),
      'HOSTED_RUNTIME_UNAVAILABLE',
    );
  });
});
