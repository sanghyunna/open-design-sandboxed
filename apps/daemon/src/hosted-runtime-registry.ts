import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  createApiError,
  type ApiErrorCode,
  type HostedProviderId,
} from '@open-design/contracts';
import {
  createHostedRuntimeStorage,
  type HostedRuntimeStorage,
} from './hosted-runtime-storage.js';
import { getProject, insertProject } from './db.js';
import {
  createProjectCheckpointService,
  type ProjectCheckpointService,
} from './project-checkpoints.js';
import { createChatRunService } from './runs.js';

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
  /** System-boundary seam for proving generation-local cleanup failures. */
  readonly createStorage?: typeof createHostedRuntimeStorage;
  /** Resource seam for proving owned run-state finalization failures. */
  readonly createRunService?: typeof createChatRunService;
}

export type HostedLeaseStrength = 'strong' | 'weak';

export interface HostedRuntimeLease {
  readonly userKey: string;
  readonly storageKey: string;
  readonly generation: number;
  readonly strength: HostedLeaseStrength;
  release(): void;
}

export interface HostedProviderCredential {
  readonly provider: HostedProviderId;
  readonly key: string;
}

export interface HostedProviderCredentialStatus {
  readonly provider: HostedProviderId | null;
  readonly configured: boolean;
}

export interface HostedRunExecutionContext {
  readonly credential: HostedProviderCredential | null;
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
  credentialStatus(lease: HostedRuntimeLease): HostedProviderCredentialStatus;
  replaceCredential(
    lease: HostedRuntimeLease,
    credential: HostedProviderCredential | null,
  ): Promise<HostedProviderCredentialStatus>;
  cancel(control: HostedRunControl, reason?: string): boolean;
  shutdown(): Promise<void>;
}

export type HostedRuntimeInternalOperation =
  | {
      readonly kind: 'project:insert';
      readonly runId: string;
      readonly conversationId: string;
      readonly project: {
        readonly id: string;
        readonly name: string;
        readonly createdAt: number;
        readonly updatedAt: number;
      };
    }
  | { readonly kind: 'project:get'; readonly projectId: string }
  | {
      readonly kind: 'checkpoint:count';
      readonly projectId: string;
      readonly conversationId?: string | null;
    }
  | { readonly kind: 'run:get'; readonly runId: string };

export interface HostedRuntimeGenerationControl {
  readonly userKey: string;
  readonly generation: number;
}

type InternalOperationDispatcher = (
  lease: HostedRuntimeLease,
  operation: HostedRuntimeInternalOperation,
) => Promise<unknown>;

const internalOperationsByRegistry = new WeakMap<
  HostedRuntimeRegistry,
  InternalOperationDispatcher
>();
const poisonByRegistry = new WeakMap<
  HostedRuntimeRegistry,
  (control: HostedRuntimeGenerationControl) => boolean
>();

/** Internal adapter seam for PR07; it never exposes owned handles or paths. */
export function dispatchHostedRuntimeInternalOperation(
  registry: HostedRuntimeRegistry,
  lease: HostedRuntimeLease,
  operation: HostedRuntimeInternalOperation,
): Promise<unknown> {
  const dispatch = internalOperationsByRegistry.get(registry);
  if (dispatch == null) {
    return Promise.reject(new HostedRuntimeError(
      'HOSTED_RUNTIME_UNAVAILABLE',
      'hosted runtime registry is unavailable',
    ));
  }
  return dispatch(lease, operation);
}

/** Generation-bound transition used by snapshot publication failure handling. */
export function poisonHostedRuntimeGeneration(
  registry: HostedRuntimeRegistry,
  control: HostedRuntimeGenerationControl,
): boolean {
  return poisonByRegistry.get(registry)?.(control) ?? false;
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

interface QueueEntryBase {
  readonly kind: 'credential' | 'run';
  readonly reject: (reason: unknown) => void;
  admissionTimer: ReturnType<typeof setTimeout> | null;
}

interface RunQueueEntry extends QueueEntryBase {
  readonly kind: 'run';
  readonly ownedRun: ReturnType<ReturnType<typeof createChatRunService>['create']>;
  readonly execute: HostedRunDispatch<unknown>['execute'];
  readonly resolve: (value: unknown) => void;
}

interface CredentialQueueEntry extends QueueEntryBase {
  readonly kind: 'credential';
  readonly credential: HostedProviderCredential | null;
  readonly resolve: (value: HostedProviderCredentialStatus) => void;
}

type QueueEntry = RunQueueEntry | CredentialQueueEntry;

interface ActiveRun {
  readonly entry: RunQueueEntry;
  readonly abort: AbortController;
  timeout: ReturnType<typeof setTimeout> | null;
  terminalError: HostedRuntimeError | null;
}

interface RuntimeState {
  readonly binding: IdentityBinding;
  readonly checkpointService: ProjectCheckpointService;
  readonly generation: number;
  readonly runService: ReturnType<typeof createChatRunService>;
  readonly sessions: Map<string, string>;
  readonly storage: HostedRuntimeStorage;
  readonly queue: QueueEntry[];
  active: ActiveRun | null;
  credential: HostedProviderCredential | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  lifecycle: 'active' | 'cleaning' | 'poisoned' | 'closed';
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
  const createStorage = options.createStorage ?? createHostedRuntimeStorage;
  const createRunService = options.createRunService ?? createChatRunService;
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
    if (existing != null) {
      if (existing.lifecycle === 'active') return existing;
      if (existing.lifecycle === 'poisoned') retirePoisoned(existing);
      if (runtimes.get(binding.userKey) === existing) {
        runtimeUnavailable('hosted runtime generation is unavailable');
      }
    }
    if (runtimes.size >= limits.residentRuntimes) {
      throw new HostedRuntimeError(
        'HOSTED_CAPACITY_EXHAUSTED',
        'hosted runtime capacity is exhausted',
      );
    }
    let storage: HostedRuntimeStorage | null = null;
    let runService: ReturnType<typeof createChatRunService> | null = null;
    try {
      storage = createStorage({
        identity: {
          storageKey: binding.storageKey,
          userKey: binding.userKey,
        },
        runtimeRoot,
      });
      const generation = binding.nextGeneration + 1;
      runService = createRunService({
        createSseErrorPayload: (code, message, init = {}) => ({
          error: createApiError(code, message, init),
          message,
        }),
        createSseResponse: () => {
          throw new HostedRuntimeError(
            'HOSTED_RUNTIME_UNAVAILABLE',
            'hosted run streaming is not active',
          );
        },
        runsLogDir: storage.roots.runsRoot,
      });
      const checkpointService = createProjectCheckpointService({
        dataDir: storage.roots.liveRoot,
        db: storage.database,
        projectsRoot: storage.roots.projectsRoot,
      });
      const runtime: RuntimeState = {
        active: null,
        binding,
        checkpointService,
        credential: null,
        generation,
        idleTimer: null,
        lifecycle: 'active',
        queue: [],
        runService,
        sessionReferenceBytes: 0,
        sessions: new Map(),
        storage,
        strongLeases: 0,
      };
      binding.nextGeneration = generation;
      runtimes.set(binding.userKey, runtime);
      scheduleIdleEviction(runtime);
      return runtime;
    } catch {
      try {
        runService?.dispose();
      } finally {
        storage?.close();
      }
      throw new HostedRuntimeError(
        'HOSTED_RUNTIME_UNAVAILABLE',
        'hosted runtime initialization failed',
      );
    }
  }

  function acquireStrong(runtime: RuntimeState): void {
    if (runtime.lifecycle !== 'active') {
      runtimeUnavailable('hosted runtime generation is unavailable');
    }
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
    if (runtime.lifecycle === 'poisoned') {
      retirePoisoned(runtime);
    } else {
      scheduleIdleEviction(runtime);
    }
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
      const state = stateForLease(lease, 'strong');
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
      let ownedRun: ReturnType<ReturnType<typeof createChatRunService>['create']>;
      try {
        ownedRun = runtime.runService.createWithId(operation.runId, {
          conversationId: operation.conversationId,
        });
      } catch (error) {
        releaseStrong(runtime);
        throw error;
      }

      return new Promise<T>((resolve, reject) => {
        const entry: RunQueueEntry = {
          admissionTimer: null,
          execute: operation.execute as HostedRunDispatch<unknown>['execute'],
          kind: 'run',
          ownedRun,
          reject,
          resolve: resolve as (value: unknown) => void,
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

  function credentialStatus(lease: HostedRuntimeLease): HostedProviderCredentialStatus {
    return statusForCredential(stateForLease(lease).runtime.credential);
  }

  function replaceCredential(
    lease: HostedRuntimeLease,
    credential: HostedProviderCredential | null,
  ): Promise<HostedProviderCredentialStatus> {
    try {
      if (shuttingDown) runtimeUnavailable('hosted runtime registry is shutting down');
      const state = stateForLease(lease, 'strong');
      const nextCredential = credential == null ? null : validateHostedProviderCredential(credential);
      const runtime = state.runtime;
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

      return new Promise<HostedProviderCredentialStatus>((resolve, reject) => {
        const entry: CredentialQueueEntry = {
          admissionTimer: null,
          credential: nextCredential,
          kind: 'credential',
          reject,
          resolve,
        };
        runtime.queue.push(entry);
        queuedMutations += 1;
        entry.admissionTimer = unrefTimer(setTimeout(() => {
          removeQueued(runtime, entry, new HostedRuntimeError(
            runtime.active == null ? 'HOSTED_CAPACITY_EXHAUSTED' : 'HOSTED_OVERLOADED',
            'hosted credential mutation admission timed out',
          ));
        }, admissionTimeoutMs));
        pump(runtime);
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function stateForLease(
    lease: HostedRuntimeLease,
    strength?: HostedLeaseStrength,
  ): LeaseState {
    const state = leaseStates.get(lease);
    if (
      state == null
      || state.released
      || (strength != null && state.strength !== strength)
      || runtimes.get(lease.userKey) !== state.runtime
      || state.runtime.generation !== lease.generation
      || state.runtime.lifecycle !== 'active'
    ) {
      runtimeUnavailable('hosted runtime lease is not active');
    }
    return state;
  }

  function pump(runtime: RuntimeState): void {
    if (
      shuttingDown
      || runtime.lifecycle !== 'active'
      || runtime.active != null
      || runtime.queue.length === 0
    ) return;
    const next = runtime.queue[0];
    if (next?.kind === 'run' && activeChildren >= limits.activeChildren) return;
    const entry = runtime.queue.shift();
    if (entry == null) return;
    queuedMutations -= 1;
    clearTimer(entry.admissionTimer);
    entry.admissionTimer = null;
    if (entry.kind === 'credential') {
      runtime.credential = entry.credential;
      releaseStrong(runtime);
      entry.resolve(statusForCredential(runtime.credential));
      pump(runtime);
      pumpAll();
      return;
    }
    const abort = new AbortController();
    const active: ActiveRun = {
      abort,
      entry,
      terminalError: null,
      timeout: null,
    };
    runtime.active = active;
    activeChildren += 1;
    entry.ownedRun.status = 'running';
    entry.ownedRun.updatedAt = Date.now();
    runtime.runService.emit(entry.ownedRun, 'start', {
      conversationId: entry.ownedRun.conversationId,
      runId: entry.ownedRun.id,
      status: 'running',
    });
    active.timeout = unrefTimer(setTimeout(() => {
      if (runtime.active !== active || active.terminalError != null) return;
      active.terminalError = new HostedRuntimeError(
        'HOSTED_RUN_TIMED_OUT',
        'hosted run exceeded its execution deadline',
      );
      abort.abort(active.terminalError);
    }, runTimeoutMs));
    const sessionReference = runtime.sessions.get(entry.ownedRun.conversationId) ?? null;
    void Promise.resolve()
      .then(() => entry.execute({
        credential: runtime.credential,
        sessionReference,
        signal: abort.signal,
      }))
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
        const conversationId = active.entry.ownedRun.conversationId;
        const previous = runtime.sessions.get(conversationId);
        const previousBytes = previous == null ? 0 : Buffer.byteLength(previous, 'utf8');
        if (sessionReference == null) {
          runtime.sessions.delete(conversationId);
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
          runtime.sessions.set(conversationId, sessionReference);
          runtime.sessionReferenceBytes = runtime.sessionReferenceBytes - previousBytes + nextBytes;
        }
      } catch (sessionError) {
        error = sessionError;
      }
    }
    if (error != null) runtime.credential = null;
    runtime.active = null;
    activeChildren -= 1;
    const finalizationError = settleOwnedRun(runtime, active.entry, error);
    if (finalizationError != null) {
      error = finalizationError;
      poisonRuntime(runtime, finalizationError);
    }
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

  function settleOwnedRun(
    runtime: RuntimeState,
    entry: RunQueueEntry,
    error: unknown,
  ): HostedRuntimeError | null {
    try {
      if (runtime.runService.isTerminal(entry.ownedRun.status)) return null;
      if (error == null) {
        runtime.runService.finish(entry.ownedRun, 'succeeded', 0, null);
        return null;
      }
      if (
        error instanceof HostedRuntimeError
        && error.code === 'HOSTED_RUN_CANCELED'
      ) {
        runtime.runService.finish(entry.ownedRun, 'canceled', null, 'SIGTERM');
        return null;
      }
      const code = error instanceof HostedRuntimeError ? error.code : 'INTERNAL_ERROR';
      const message = error instanceof Error ? error.message : String(error);
      runtime.runService.fail(entry.ownedRun, code, message);
      return null;
    } catch {
      return new HostedRuntimeError(
        'HOSTED_RUNTIME_UNAVAILABLE',
        'hosted run state finalization failed',
      );
    }
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
    const finalizationError = entry.kind === 'run'
      ? settleOwnedRun(runtime, entry, error)
      : null;
    if (finalizationError != null) poisonRuntime(runtime, finalizationError);
    releaseStrong(runtime);
    entry.reject(finalizationError ?? error);
    pump(runtime);
    return true;
  }

  function cancel(control: HostedRunControl, reason = 'canceled'): boolean {
    const runtime = runtimes.get(control.userKey);
    if (
      runtime == null
      || runtime.generation !== control.generation
      || runtime.lifecycle !== 'active'
    ) return false;
    const error = new HostedRuntimeError(
      'HOSTED_RUN_CANCELED',
      `hosted run was canceled (${reason})`,
    );
    if (runtime.active?.entry.ownedRun.id === control.runId) {
      runtime.active.terminalError ??= error;
      runtime.active.abort.abort(runtime.active.terminalError);
      return true;
    }
    const queued = runtime.queue.find(
      (entry): entry is RunQueueEntry =>
        entry.kind === 'run' && entry.ownedRun.id === control.runId,
    );
    return queued == null ? false : removeQueued(runtime, queued, error);
  }

  function scheduleIdleEviction(runtime: RuntimeState): void {
    if (
      shuttingDown
      || runtime.lifecycle !== 'active'
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
        && runtime.lifecycle === 'active'
        && runtime.strongLeases === 0
        && runtime.active == null
        && runtime.queue.length === 0
      ) {
        try {
          retire(runtime);
        } catch {
          // A failed user's cleanup stays published as poisoned. Timer failures
          // never escape into the daemon event loop or affect another runtime.
        }
      }
    }, idleEvictionMs));
  }

  function retire(runtime: RuntimeState): void {
    if (
      runtimes.get(runtime.binding.userKey) !== runtime
      || runtime.lifecycle === 'closed'
      || runtime.lifecycle === 'cleaning'
    ) return;
    clearIdleTimer(runtime);
    const generation = runtime.generation;
    runtime.lifecycle = 'cleaning';
    runtime.sessions.clear();
    runtime.sessionReferenceBytes = 0;
    runtime.credential = null;
    const errors: unknown[] = [];
    try {
      runtime.runService.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      runtime.storage.close();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) {
      runtime.lifecycle = 'poisoned';
      throw errors.length === 1
        ? errors[0]
        : new AggregateError(errors, 'hosted runtime cleanup failed');
    }
    runtime.lifecycle = 'closed';
    const published = runtimes.get(runtime.binding.userKey);
    if (published === runtime && published.generation === generation) {
      runtimes.delete(runtime.binding.userKey);
    }
  }

  function retirePoisoned(runtime: RuntimeState): void {
    if (
      runtime.lifecycle !== 'poisoned'
      || runtime.strongLeases !== 0
      || runtime.active != null
      || runtime.queue.length !== 0
    ) return;
    try {
      retire(runtime);
    } catch {
      // The failed generation remains poisoned and resident for a later retry.
    }
  }

  function poison(control: HostedRuntimeGenerationControl): boolean {
    const runtime = runtimes.get(control.userKey);
    if (
      runtime == null
      || runtime.generation !== control.generation
      || runtime.lifecycle !== 'active'
    ) return false;
    const error = new HostedRuntimeError(
      'HOSTED_RUNTIME_UNAVAILABLE',
      'hosted runtime generation was poisoned',
    );
    return poisonRuntime(runtime, error);
  }

  function poisonRuntime(
    runtime: RuntimeState,
    error: HostedRuntimeError,
  ): boolean {
    if (
      runtimes.get(runtime.binding.userKey) !== runtime
      || runtime.lifecycle !== 'active'
    ) return false;
    runtime.lifecycle = 'poisoned';
    clearIdleTimer(runtime);
    runtime.credential = null;
    for (const entry of [...runtime.queue]) removeQueued(runtime, entry, error);
    if (runtime.active != null) {
      runtime.active.terminalError ??= error;
      runtime.active.abort.abort(runtime.active.terminalError);
    }
    retirePoisoned(runtime);
    return true;
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
    for (const runtime of [...runtimes.values()]) {
      try {
        retire(runtime);
      } catch {
        return;
      }
    }
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
      runtime.credential = null;
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
      || runtime.active?.entry.ownedRun.conversationId === conversationId
      || runtime.queue.some(
        (entry) => entry.kind === 'run' && entry.ownedRun.conversationId === conversationId,
      );
  }

  function reservedConversationCount(runtime: RuntimeState): number {
    const conversations = new Set(runtime.sessions.keys());
    if (runtime.active != null) conversations.add(runtime.active.entry.ownedRun.conversationId);
    for (const entry of runtime.queue) {
      if (entry.kind === 'run') conversations.add(entry.ownedRun.conversationId);
    }
    return conversations.size;
  }

  function dispatchInternalOperation(
    lease: HostedRuntimeLease,
    operation: HostedRuntimeInternalOperation,
  ): Promise<unknown> {
    try {
      const state = stateForLease(lease, 'strong');
      switch (operation.kind) {
        case 'project:insert': {
          validateInternalId(operation.project.id, 'project');
          return dispatch(lease, {
            conversationId: operation.conversationId,
            runId: operation.runId,
            execute: async () => {
              const project = insertProject(
                state.runtime.storage.database,
                operation.project,
              );
              return {
                value: project == null ? null : { id: project.id, name: project.name },
              };
            },
          });
        }
        case 'project:get': {
          validateInternalId(operation.projectId, 'project');
          const project = getProject(state.runtime.storage.database, operation.projectId);
          return Promise.resolve(
            project == null ? null : { id: project.id, name: project.name },
          );
        }
        case 'checkpoint:count': {
          validateInternalId(operation.projectId, 'project');
          const checkpoints = state.runtime.checkpointService.listCheckpoints(
            operation.projectId,
            operation.conversationId,
          );
          return Promise.resolve(checkpoints.length);
        }
        case 'run:get': {
          validateInternalId(operation.runId, 'run');
          const run = state.runtime.runService.get(operation.runId);
          if (run == null) return Promise.resolve(null);
          const status = state.runtime.runService.statusBody(run);
          return Promise.resolve({
            conversationId: status.conversationId,
            runId: status.id,
            status: status.status,
          });
        }
      }
    } catch (error) {
      return Promise.reject(error);
    }
  }

  const registry: HostedRuntimeRegistry = {
    acquire,
    cancel,
    credentialStatus,
    dispatch,
    replaceCredential,
    shutdown,
  };
  internalOperationsByRegistry.set(registry, dispatchInternalOperation);
  poisonByRegistry.set(registry, poison);
  return registry;
}

export function validateHostedProviderCredential(
  credential: HostedProviderCredential,
): HostedProviderCredential {
  if (
    credential == null
    || (credential.provider !== 'anthropic' && credential.provider !== 'vercel-ai-gateway')
    || typeof credential.key !== 'string'
  ) {
    throw new HostedRuntimeError('HOSTED_AUTH_INVALID', 'hosted provider credential is invalid');
  }
  const keyBytes = Buffer.from(credential.key, 'utf8');
  if (
    keyBytes.length < 1
    || keyBytes.length > 16 * 1024
    || keyBytes.toString('utf8') !== credential.key
    || /[\u0000\r\n]/u.test(credential.key)
  ) {
    throw new HostedRuntimeError('HOSTED_AUTH_INVALID', 'hosted provider credential is invalid');
  }
  return Object.freeze({ key: credential.key, provider: credential.provider });
}

function statusForCredential(
  credential: HostedProviderCredential | null,
): HostedProviderCredentialStatus {
  return Object.freeze({
    configured: credential != null,
    provider: credential?.provider ?? null,
  });
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
