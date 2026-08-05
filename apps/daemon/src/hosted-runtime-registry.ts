import { createHash } from 'node:crypto';
import path from 'node:path';
import type { ApiErrorCode } from '@open-design/contracts';

const DEFAULT_LIMITS = Object.freeze({
  activeChildren: 32,
  identityBindings: 65_536,
  queuedMutationsGlobal: 512,
  queuedMutationsPerUser: 16,
  residentRuntimes: 64,
  sessionReferenceBytesPerUser: 1024 * 1024,
  sessionReferencesPerUser: 1_000,
  strongLeasesGlobal: 2_048,
  strongLeasesPerUser: 64,
  weakLeasesGlobal: 256,
  weakLeasesPerUser: 4,
});

type HostedRuntimeErrorCode = Extract<ApiErrorCode,
  | 'HOSTED_AUTH_INVALID'
  | 'HOSTED_CAPACITY_EXHAUSTED'
  | 'HOSTED_OVERLOADED'
  | 'HOSTED_QUOTA_EXCEEDED'
  | 'HOSTED_RUNTIME_UNAVAILABLE'
  | 'HOSTED_RUN_CANCELED'
  | 'HOSTED_RUN_TIMED_OUT'
  | 'HOSTED_SHUTDOWN_TIMEOUT'
>;

export class HostedRuntimeError extends Error {
  readonly code: HostedRuntimeErrorCode;

  constructor(code: HostedRuntimeErrorCode, message: string) {
    super(message);
    this.name = 'HostedRuntimeError';
    this.code = code;
  }
}

export interface HostedRuntimeIdentity {
  readonly userKey: string;
}

export interface HostedRuntimeLimits {
  readonly activeChildren: number;
  readonly identityBindings: number;
  readonly queuedMutationsGlobal: number;
  readonly queuedMutationsPerUser: number;
  readonly residentRuntimes: number;
  readonly sessionReferenceBytesPerUser: number;
  readonly sessionReferencesPerUser: number;
  readonly strongLeasesGlobal: number;
  readonly strongLeasesPerUser: number;
  readonly weakLeasesGlobal: number;
  readonly weakLeasesPerUser: number;
}

export interface HostedRuntimeRegistryOptions {
  readonly runtimeRoot: string;
  readonly limits?: Partial<HostedRuntimeLimits>;
  readonly idleEvictionMs?: number;
  readonly admissionTimeoutMs?: number;
  readonly runTimeoutMs?: number;
  readonly shutdownTimeoutMs?: number;
  /** Test seam for proving reverse-binding collision rejection. */
  readonly deriveStorageKey?: (userKey: string) => string;
}

export type HostedLeaseStrength = 'strong' | 'weak';

export interface HostedRuntimeLease {
  readonly userKey: string;
  readonly storageKey: string;
  readonly generation: number;
  readonly strength: HostedLeaseStrength;
  release(): void;
}

export interface HostedRunExecutionContext {
  readonly signal: AbortSignal;
  readonly sessionReference: string | null;
}

export interface HostedRunExecutionResult<T> {
  readonly value: T;
  readonly sessionReference?: string | null;
}

export interface HostedRunDispatch<T> {
  readonly runId: string;
  readonly conversationId: string;
  readonly execute: (
    context: HostedRunExecutionContext,
  ) => Promise<HostedRunExecutionResult<T>>;
}

export interface HostedRunControl {
  readonly userKey: string;
  readonly generation: number;
  readonly runId: string;
}

export interface HostedRuntimeRegistry {
  acquire(
    identity: HostedRuntimeIdentity,
    strength?: HostedLeaseStrength,
  ): HostedRuntimeLease;
  dispatch<T>(
    lease: HostedRuntimeLease,
    operation: HostedRunDispatch<T>,
  ): Promise<T>;
  cancel(control: HostedRunControl, reason?: string): boolean;
  shutdown(): Promise<void>;
}

interface IdentityBinding {
  readonly userKey: string;
  readonly storageKey: string;
  nextGeneration: number;
  weakLeases: number;
}

interface LeaseState {
  readonly runtime: RuntimeState;
  readonly strength: HostedLeaseStrength;
  released: boolean;
}

interface QueueEntry {
  readonly runId: string;
  readonly conversationId: string;
  readonly execute: HostedRunDispatch<unknown>['execute'];
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  admissionTimer: ReturnType<typeof setTimeout> | null;
}

interface ActiveRun {
  readonly entry: QueueEntry;
  readonly abort: AbortController;
  timeout: ReturnType<typeof setTimeout> | null;
  terminalError: HostedRuntimeError | null;
}

interface RuntimeState {
  readonly binding: IdentityBinding;
  readonly generation: number;
  readonly root: string;
  readonly sessions: Map<string, string>;
  readonly queue: QueueEntry[];
  active: ActiveRun | null;
  credential: null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  sessionReferenceBytes: number;
  strongLeases: number;
}

const DEFAULT_IDLE_EVICTION_MS = 5 * 60_000;
const DEFAULT_ADMISSION_TIMEOUT_MS = 30_000;
const DEFAULT_RUN_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 60_000;

export function deriveHostedStorageKey(userKey: string): string {
  validateUserKey(userKey);
  return `od1_${createHash('sha256').update(userKey, 'utf8').digest('hex')}`;
}

export function createHostedRuntimeRegistry(
  options: HostedRuntimeRegistryOptions,
): HostedRuntimeRegistry {
  const runtimeRoot = path.resolve(options.runtimeRoot);
  const limits = validateLimits({ ...DEFAULT_LIMITS, ...options.limits });
  const idleEvictionMs = duration(options.idleEvictionMs, DEFAULT_IDLE_EVICTION_MS);
  const admissionTimeoutMs = duration(options.admissionTimeoutMs, DEFAULT_ADMISSION_TIMEOUT_MS);
  const runTimeoutMs = duration(options.runTimeoutMs, DEFAULT_RUN_TIMEOUT_MS);
  const shutdownTimeoutMs = duration(options.shutdownTimeoutMs, DEFAULT_SHUTDOWN_TIMEOUT_MS);
  const deriveStorageKey = options.deriveStorageKey ?? deriveHostedStorageKey;
  const bindingsByUser = new Map<string, IdentityBinding>();
  const bindingsByStorage = new Map<string, IdentityBinding>();
  const runtimes = new Map<string, RuntimeState>();
  const leaseStates = new WeakMap<HostedRuntimeLease, LeaseState>();
  let activeChildren = 0;
  let queuedMutations = 0;
  let strongLeases = 0;
  let weakLeases = 0;
  let shuttingDown = false;
  let shutdownPromise: Promise<void> | null = null;
  let resolveShutdown!: () => void;
  const shutdownDrained = new Promise<void>((resolve) => { resolveShutdown = resolve; });

  function bindingFor(identity: HostedRuntimeIdentity): IdentityBinding {
    validateUserKey(identity.userKey);
    const storageKey = deriveStorageKey(identity.userKey);
    if (!/^od1_[0-9a-f]{64}$/u.test(storageKey)) {
      throw new HostedRuntimeError(
        'HOSTED_AUTH_INVALID',
        'hosted identity produced an invalid storage namespace',
      );
    }
    const existingUser = bindingsByUser.get(identity.userKey);
    if (existingUser != null) {
      if (existingUser.storageKey !== storageKey) identityCollision();
      return existingUser;
    }
    const existingStorage = bindingsByStorage.get(storageKey);
    if (existingStorage != null && existingStorage.userKey !== identity.userKey) {
      identityCollision();
    }
    if (bindingsByUser.size >= limits.identityBindings) {
      throw new HostedRuntimeError(
        'HOSTED_CAPACITY_EXHAUSTED',
        'hosted identity binding capacity is exhausted',
      );
    }
    const binding: IdentityBinding = {
      userKey: identity.userKey,
      storageKey,
      nextGeneration: 0,
      weakLeases: 0,
    };
    bindingsByUser.set(identity.userKey, binding);
    bindingsByStorage.set(storageKey, binding);
    return binding;
  }

  function runtimeFor(identity: HostedRuntimeIdentity): RuntimeState {
    if (
      !bindingsByUser.has(identity.userKey)
      && runtimes.size >= limits.residentRuntimes
    ) {
      throw new HostedRuntimeError(
        'HOSTED_CAPACITY_EXHAUSTED',
        'hosted runtime capacity is exhausted',
      );
    }
    const binding = bindingFor(identity);
    const existing = runtimes.get(binding.userKey);
    if (existing != null) return existing;
    if (runtimes.size >= limits.residentRuntimes) {
      throw new HostedRuntimeError(
        'HOSTED_CAPACITY_EXHAUSTED',
        'hosted runtime capacity is exhausted',
      );
    }
    const runtime: RuntimeState = {
      active: null,
      binding,
      credential: null,
      generation: ++binding.nextGeneration,
      idleTimer: null,
      queue: [],
      root: path.join(runtimeRoot, binding.storageKey),
      sessionReferenceBytes: 0,
      sessions: new Map(),
      strongLeases: 0,
    };
    runtimes.set(binding.userKey, runtime);
    scheduleIdleEviction(runtime);
    return runtime;
  }

  function acquireStrong(runtime: RuntimeState): void {
    if (runtime.strongLeases >= limits.strongLeasesPerUser) {
      throw new HostedRuntimeError('HOSTED_OVERLOADED', 'hosted user lease limit exceeded');
    }
    if (strongLeases >= limits.strongLeasesGlobal) {
      throw new HostedRuntimeError(
        'HOSTED_CAPACITY_EXHAUSTED',
        'hosted process lease capacity is exhausted',
      );
    }
    clearIdleTimer(runtime);
    runtime.strongLeases += 1;
    strongLeases += 1;
  }

  function releaseStrong(runtime: RuntimeState): void {
    runtime.strongLeases -= 1;
    strongLeases -= 1;
    scheduleIdleEviction(runtime);
    tryFinishShutdown();
  }

  function acquire(
    identity: HostedRuntimeIdentity,
    strength: HostedLeaseStrength = 'strong',
  ): HostedRuntimeLease {
    if (shuttingDown) runtimeUnavailable('hosted runtime registry is shutting down');
    const runtime = runtimeFor(identity);
    if (strength === 'strong') {
      acquireStrong(runtime);
    } else {
      if (runtime.binding.weakLeases >= limits.weakLeasesPerUser) {
        throw new HostedRuntimeError('HOSTED_OVERLOADED', 'hosted user weak lease limit exceeded');
      }
      if (weakLeases >= limits.weakLeasesGlobal) {
        throw new HostedRuntimeError(
          'HOSTED_CAPACITY_EXHAUSTED',
          'hosted process weak lease capacity is exhausted',
        );
      }
      runtime.binding.weakLeases += 1;
      weakLeases += 1;
    }

    let lease!: HostedRuntimeLease;
    lease = Object.freeze({
      generation: runtime.generation,
      release(): void {
        const state = leaseStates.get(lease);
        if (state == null || state.released) return;
        state.released = true;
        if (state.strength === 'strong') {
          releaseStrong(state.runtime);
        } else {
          state.runtime.binding.weakLeases -= 1;
          weakLeases -= 1;
        }
      },
      storageKey: runtime.binding.storageKey,
      strength,
      userKey: runtime.binding.userKey,
    });
    leaseStates.set(lease, { released: false, runtime, strength });
    return lease;
  }

  function dispatch<T>(
    lease: HostedRuntimeLease,
    operation: HostedRunDispatch<T>,
  ): Promise<T> {
    try {
      if (shuttingDown) runtimeUnavailable('hosted runtime registry is shutting down');
      const state = leaseStates.get(lease);
      if (
        state == null
        || state.released
        || state.strength !== 'strong'
        || runtimes.get(lease.userKey) !== state.runtime
        || state.runtime.generation !== lease.generation
      ) {
        runtimeUnavailable('hosted runtime lease is not active');
      }
      validateInternalId(operation.runId, 'run');
      validateInternalId(operation.conversationId, 'conversation');
      const runtime = state.runtime;
      if (
        !conversationIsReserved(runtime, operation.conversationId)
        && reservedConversationCount(runtime) >= limits.sessionReferencesPerUser
      ) {
        throw new HostedRuntimeError(
          'HOSTED_QUOTA_EXCEEDED',
          'hosted user session reference limit exceeded',
        );
      }
      if (runtime.queue.length >= limits.queuedMutationsPerUser) {
        throw new HostedRuntimeError('HOSTED_OVERLOADED', 'hosted user mutation queue is full');
      }
      if (queuedMutations >= limits.queuedMutationsGlobal) {
        throw new HostedRuntimeError(
          'HOSTED_CAPACITY_EXHAUSTED',
          'hosted process mutation queue is full',
        );
      }
      acquireStrong(runtime);

      return new Promise<T>((resolve, reject) => {
        const entry: QueueEntry = {
          admissionTimer: null,
          conversationId: operation.conversationId,
          execute: operation.execute as HostedRunDispatch<unknown>['execute'],
          reject,
          resolve: resolve as (value: unknown) => void,
          runId: operation.runId,
        };
        runtime.queue.push(entry);
        queuedMutations += 1;
        entry.admissionTimer = unrefTimer(setTimeout(() => {
          const code = runtime.active == null
            ? 'HOSTED_CAPACITY_EXHAUSTED'
            : 'HOSTED_OVERLOADED';
          removeQueued(runtime, entry, new HostedRuntimeError(
            code,
            'hosted run admission timed out',
          ));
        }, admissionTimeoutMs));
        pump(runtime);
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function pump(runtime: RuntimeState): void {
    if (shuttingDown || runtime.active != null || runtime.queue.length === 0) return;
    if (activeChildren >= limits.activeChildren) return;
    const entry = runtime.queue.shift();
    if (entry == null) return;
    queuedMutations -= 1;
    clearTimer(entry.admissionTimer);
    entry.admissionTimer = null;
    const abort = new AbortController();
    const active: ActiveRun = {
      abort,
      entry,
      terminalError: null,
      timeout: null,
    };
    runtime.active = active;
    activeChildren += 1;
    active.timeout = unrefTimer(setTimeout(() => {
      if (runtime.active !== active || active.terminalError != null) return;
      active.terminalError = new HostedRuntimeError(
        'HOSTED_RUN_TIMED_OUT',
        'hosted run exceeded its execution deadline',
      );
      abort.abort(active.terminalError);
    }, runTimeoutMs));
    const sessionReference = runtime.sessions.get(entry.conversationId) ?? null;
    void Promise.resolve()
      .then(() => entry.execute({ sessionReference, signal: abort.signal }))
      .then(
        (result) => finishRun(runtime, active, result, null),
        (error: unknown) => finishRun(runtime, active, null, error),
      );
  }

  function finishRun(
    runtime: RuntimeState,
    active: ActiveRun,
    result: HostedRunExecutionResult<unknown> | null,
    executionError: unknown,
  ): void {
    if (runtime.active !== active) return;
    clearTimer(active.timeout);
    let error = active.terminalError ?? executionError;
    if (error == null && result != null && result.sessionReference !== undefined) {
      try {
        const sessionReference = result.sessionReference;
        const previous = runtime.sessions.get(active.entry.conversationId);
        const previousBytes = previous == null ? 0 : Buffer.byteLength(previous, 'utf8');
        if (sessionReference == null) {
          runtime.sessions.delete(active.entry.conversationId);
          runtime.sessionReferenceBytes -= previousBytes;
        } else {
          validateSessionReference(sessionReference);
          const nextBytes = Buffer.byteLength(sessionReference, 'utf8');
          if (
            runtime.sessionReferenceBytes - previousBytes + nextBytes
            > limits.sessionReferenceBytesPerUser
          ) {
            throw new HostedRuntimeError(
              'HOSTED_QUOTA_EXCEEDED',
              'hosted user session reference bytes exceeded',
            );
          }
          runtime.sessions.set(active.entry.conversationId, sessionReference);
          runtime.sessionReferenceBytes = runtime.sessionReferenceBytes - previousBytes + nextBytes;
        }
      } catch (sessionError) {
        error = sessionError;
      }
    }
    runtime.active = null;
    activeChildren -= 1;
    releaseStrong(runtime);
    if (error == null && result != null) {
      active.entry.resolve(result.value);
    } else {
      active.entry.reject(error ?? new Error('hosted run failed without an error'));
    }
    pump(runtime);
    pumpAll();
    scheduleIdleEviction(runtime);
    tryFinishShutdown();
  }

  function pumpAll(): void {
    if (activeChildren >= limits.activeChildren) return;
    for (const runtime of runtimes.values()) {
      pump(runtime);
      if (activeChildren >= limits.activeChildren) return;
    }
  }

  function removeQueued(
    runtime: RuntimeState,
    entry: QueueEntry,
    error: HostedRuntimeError,
  ): boolean {
    const index = runtime.queue.indexOf(entry);
    if (index < 0) return false;
    runtime.queue.splice(index, 1);
    queuedMutations -= 1;
    clearTimer(entry.admissionTimer);
    entry.admissionTimer = null;
    releaseStrong(runtime);
    entry.reject(error);
    pump(runtime);
    return true;
  }

  function cancel(control: HostedRunControl, reason = 'canceled'): boolean {
    const runtime = runtimes.get(control.userKey);
    if (runtime == null || runtime.generation !== control.generation) return false;
    const error = new HostedRuntimeError(
      'HOSTED_RUN_CANCELED',
      `hosted run was canceled (${reason})`,
    );
    if (runtime.active?.entry.runId === control.runId) {
      runtime.active.terminalError ??= error;
      runtime.active.abort.abort(runtime.active.terminalError);
      return true;
    }
    const queued = runtime.queue.find((entry) => entry.runId === control.runId);
    return queued == null ? false : removeQueued(runtime, queued, error);
  }

  function scheduleIdleEviction(runtime: RuntimeState): void {
    if (
      shuttingDown
      || runtime.strongLeases !== 0
      || runtime.active != null
      || runtime.queue.length !== 0
      || runtimes.get(runtime.binding.userKey) !== runtime
    ) return;
    clearIdleTimer(runtime);
    const generation = runtime.generation;
    runtime.idleTimer = unrefTimer(setTimeout(() => {
      if (
        runtimes.get(runtime.binding.userKey) === runtime
        && runtime.generation === generation
        && runtime.strongLeases === 0
        && runtime.active == null
        && runtime.queue.length === 0
      ) {
        evict(runtime);
      }
    }, idleEvictionMs));
  }

  function evict(runtime: RuntimeState): void {
    if (runtimes.get(runtime.binding.userKey) !== runtime) return;
    clearIdleTimer(runtime);
    runtime.sessions.clear();
    runtime.sessionReferenceBytes = 0;
    runtime.credential = null;
    runtimes.delete(runtime.binding.userKey);
  }

  function clearIdleTimer(runtime: RuntimeState): void {
    clearTimer(runtime.idleTimer);
    runtime.idleTimer = null;
  }

  function tryFinishShutdown(): void {
    if (!shuttingDown) return;
    for (const runtime of runtimes.values()) {
      if (
        runtime.strongLeases !== 0
        || runtime.active != null
        || runtime.queue.length !== 0
      ) return;
    }
    for (const runtime of [...runtimes.values()]) evict(runtime);
    resolveShutdown();
  }

  function shutdown(): Promise<void> {
    if (shutdownPromise != null) return shutdownPromise;
    shuttingDown = true;
    const canceled = new HostedRuntimeError(
      'HOSTED_RUN_CANCELED',
      'hosted run was canceled by shutdown',
    );
    for (const runtime of runtimes.values()) {
      clearIdleTimer(runtime);
      for (const entry of [...runtime.queue]) removeQueued(runtime, entry, canceled);
      if (runtime.active != null) {
        runtime.active.terminalError ??= canceled;
        runtime.active.abort.abort(runtime.active.terminalError);
      }
    }
    tryFinishShutdown();
    shutdownPromise = new Promise<void>((resolve, reject) => {
      const timeout = unrefTimer(setTimeout(() => reject(new HostedRuntimeError(
        'HOSTED_SHUTDOWN_TIMEOUT',
        'hosted runtime shutdown timed out',
      )), shutdownTimeoutMs));
      void shutdownDrained.then(() => {
        clearTimer(timeout);
        resolve();
      });
    });
    return shutdownPromise;
  }

  function conversationIsReserved(runtime: RuntimeState, conversationId: string): boolean {
    return runtime.sessions.has(conversationId)
      || runtime.active?.entry.conversationId === conversationId
      || runtime.queue.some((entry) => entry.conversationId === conversationId);
  }

  function reservedConversationCount(runtime: RuntimeState): number {
    const conversations = new Set(runtime.sessions.keys());
    if (runtime.active != null) conversations.add(runtime.active.entry.conversationId);
    for (const entry of runtime.queue) conversations.add(entry.conversationId);
    return conversations.size;
  }

  return { acquire, cancel, dispatch, shutdown };
}

function validateUserKey(userKey: string): void {
  if (typeof userKey !== 'string') identityCollision();
  const bytes = Buffer.from(userKey, 'utf8');
  if (bytes.length < 1 || bytes.length > 1_024 || bytes.toString('utf8') !== userKey) {
    throw new HostedRuntimeError('HOSTED_AUTH_INVALID', 'hosted user identity is invalid');
  }
}

function validateInternalId(value: string, label: string): void {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new HostedRuntimeError('HOSTED_RUNTIME_UNAVAILABLE', `hosted ${label} identifier is invalid`);
  }
}

function validateSessionReference(value: string): void {
  if (value.length < 1 || value.length > 32_768 || value.includes('\u0000')) {
    throw new HostedRuntimeError('HOSTED_RUNTIME_UNAVAILABLE', 'hosted session reference is invalid');
  }
}

function identityCollision(): never {
  throw new HostedRuntimeError('HOSTED_AUTH_INVALID', 'hosted identity namespace collision');
}

function runtimeUnavailable(message: string): never {
  throw new HostedRuntimeError('HOSTED_RUNTIME_UNAVAILABLE', message);
}

function duration(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > fallback) {
    throw new Error('hosted runtime durations must be positive safe integers within the fixed maximum');
  }
  return resolved;
}

function validateLimits(limits: HostedRuntimeLimits): HostedRuntimeLimits {
  for (const [name, value] of Object.entries(limits) as Array<
    [keyof HostedRuntimeLimits, number]
  >) {
    if (
      !Number.isSafeInteger(value)
      || value < 1
      || value > DEFAULT_LIMITS[name]
    ) {
      throw new Error('hosted runtime limits must be positive safe integers within the fixed maximum');
    }
  }
  return Object.freeze(limits);
}

function clearTimer(timer: ReturnType<typeof setTimeout> | null): void {
  if (timer != null) clearTimeout(timer);
}

function unrefTimer<T extends ReturnType<typeof setTimeout>>(timer: T): T {
  timer.unref?.();
  return timer;
}
