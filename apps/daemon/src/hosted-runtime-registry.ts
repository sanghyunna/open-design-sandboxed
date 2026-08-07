import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
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
import {
  createHostedSnapshotStore,
  HostedSnapshotError,
  type HostedSnapshotStore,
} from './hosted-snapshots.js';
import {
  createHostedDurabilityCoordinator,
  HostedDurabilityError,
  type HostedDurabilityCoordinator,
} from './hosted-durability.js';
import {
  createHostedRunReceiptStore,
  HostedRunReceiptError,
  type HostedRunReceipt,
  type HostedRunReceiptRouteKind,
  type HostedRunReceiptStore,
} from './hosted-run-receipts.js';
import {
  createHostedEventBudget,
  createHostedEventJournal,
  HOSTED_EVENT_LIMITS,
  type HostedDurableEventInput,
  type HostedDurableEventMilestone,
  type HostedEventChannel,
  type HostedEventJournalSnapshotV1,
  type HostedPreparedDurableEventBatch,
} from './hosted-event-journal.js';
import {
  createHostedArtifactAdapter,
  type HostedArtifactAdapter,
} from './hosted-artifact-adapter.js';
import {
  createHostedContentAdapter,
  type HostedContentMutationOperation,
  type HostedContentReadOperation,
} from './hosted-content-adapter.js';
import {
  createHostedContentQuota,
  type HostedContentQuotaOperation,
} from './hosted-content-quota.js';
import {
  createHostedDownloadStreams,
  type HostedArchiveDownload,
} from './hosted-download-stream.js';
import {
  beginHostedUploadIntake,
  type HostedMultipartFileDescriptor,
  type HostedUploadedFile,
} from './hosted-upload-adapter.js';
import {
  clearAgentSession,
  deleteConversation,
  deleteProject,
  getConversation,
  getProject,
  insertConversation,
  insertProject,
  listConversations,
  listMessages,
  listPreviewComments,
  listProjects,
  listTabs,
  setTabs,
  updateConversation,
  updateProject,
  upsertAgentSession,
  upsertMessage,
  upsertPreviewComment,
} from './db.js';
import {
  HOSTED_METADATA_RESOURCE_LIMITS,
  type HostedMetadataMutationOperation,
  type HostedMetadataReadOperation,
} from './hosted-metadata-adapter.js';
import type {
  NormalizedHostedRunIntentV1,
} from './hosted-run-adapter.js';
import type {
  HostedPiTurnInput,
  HostedPiTurnResult,
} from './runtimes/hosted-pi-turn.js';
import {
  createProjectCheckpointService,
  type ProjectCheckpointService,
} from './project-checkpoints.js';
import { createChatRunService } from './runs.js';
import {
  createProjectFolder,
  deleteProjectFile,
  deleteProjectFolder,
  listFiles,
  listProjectFolders,
  readProjectFile,
  renameProjectFile,
  searchProjectFiles,
  writeProjectFile,
  ProjectFileContentConflictError,
} from './projects.js';
import { buildProjectExportManifestResponse } from './import-export-routes.js';

const DEFAULT_LIMITS = Object.freeze({
  activeChildren: 32,
  identityBindings: 65_536,
  metadataCommentsPerUser: HOSTED_METADATA_RESOURCE_LIMITS.commentsPerUser,
  metadataConversationsPerUser: HOSTED_METADATA_RESOURCE_LIMITS.conversationsPerUser,
  metadataMessagesPerUser: HOSTED_METADATA_RESOURCE_LIMITS.messagesPerUser,
  metadataProjectsPerUser: HOSTED_METADATA_RESOURCE_LIMITS.projectsPerUser,
  metadataTabsPerUser: HOSTED_METADATA_RESOURCE_LIMITS.tabsPerUser,
  queuedMutationsGlobal: 512,
  queuedMutationsPerUser: 16,
  retainedRunsPerUser: 1_000,
  residentRuntimes: 64,
  sessionReferenceBytesPerUser: 1024 * 1024,
  sessionReferencesPerUser: 1_000,
  strongLeasesGlobal: 2_048,
  strongLeasesPerUser: 64,
  weakLeasesGlobal: 256,
  weakLeasesPerUser: 4,
});

export class HostedRuntimeError extends Error {
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
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
  readonly metadataCommentsPerUser: number;
  readonly metadataConversationsPerUser: number;
  readonly metadataMessagesPerUser: number;
  readonly metadataProjectsPerUser: number;
  readonly metadataTabsPerUser: number;
  readonly queuedMutationsGlobal: number;
  readonly queuedMutationsPerUser: number;
  readonly retainedRunsPerUser: number;
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
  /** System-boundary seam for proving snapshot publication failures. */
  readonly createSnapshotStore?: typeof createHostedSnapshotStore;
  /** Test-only deterministic identifier seam; production uses UUIDs. */
  readonly createEntityId?: (
    kind: 'project' | 'conversation' | 'message',
    userKey: string,
  ) => string;
  /** Server-owned curated project catalogue membership. */
  readonly projectCatalogueIds?: ReadonlySet<string>;
  readonly skillCatalogueIds?: ReadonlySet<string>;
  readonly designSystemCatalogueIds?: ReadonlySet<string>;
  /** Process-boundary seam; production dynamically loads the hosted Pi turn. */
  readonly startTurn?: (input: HostedPiTurnInput) => Promise<HostedPiTurnResult>;
  /** Generation lifecycle hook for server-owned journals and scoped grants. */
  readonly onGenerationRetired?: (binding: HostedRuntimeGenerationControl) => void;
  /** Process-wide event capacity; every resident user journal shares this budget. */
  readonly eventBudgetLimits?: Parameters<typeof createHostedEventBudget>[0];
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
  readonly projectId?: string;
  readonly assistantMessageId?: string;
  readonly agentId?: string;
  readonly clientRequestId?: string;
  readonly onAdmitted?: () => void;
  /** Runs synchronously after owned run-state settles and before this user's lane is released. */
  readonly onTerminal?: (error: unknown | null) => void;
  readonly execute: (
    context: HostedRunExecutionContext,
  ) => Promise<HostedRunExecutionResult<T>>;
}

export interface HostedRunControl {
  readonly userKey: string;
  readonly generation: number;
  readonly runId: string;
}

export interface HostedRunJournalEventSpec {
  readonly channel: HostedEventChannel;
  readonly data: unknown;
  readonly event: string;
  readonly milestone: HostedDurableEventMilestone | null;
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
  | { readonly kind: 'run:get'; readonly runId: string }
  | {
      readonly kind: 'runs:list';
      readonly projectId?: string;
      readonly conversationId?: string;
      readonly status?: string;
    }
  | { readonly kind: 'run:wait'; readonly runId: string }
  | {
      readonly kind: 'run:mutate';
      readonly scope:
        | { readonly kind: 'run'; readonly runId: string }
        | { readonly kind: 'project'; readonly projectId: string };
      readonly execute: () => unknown;
    }
  | {
      readonly kind: 'run:start';
      readonly runId: string;
      readonly routeKind?: HostedRunReceiptRouteKind;
      readonly intent: NormalizedHostedRunIntentV1;
      readonly model: string;
      readonly modelCatalogue: readonly string[];
      readonly thinkingCatalogue: readonly string[];
      readonly mapEvent: (
        channel: string,
        payload: Record<string, unknown>,
      ) => readonly HostedRunJournalEventSpec[];
    }
  | {
      readonly kind: 'metadata:read';
      readonly operation: HostedMetadataReadOperation;
    }
  | {
      readonly kind: 'metadata:mutate';
      readonly operation: HostedMetadataMutationOperation;
    }
  | {
      readonly kind: 'snapshot:publish';
      readonly quiesce: () => Promise<void>;
    }
  | { readonly kind: 'content:dispatch'; readonly request: unknown }
  | {
      readonly kind: 'archive:open';
      readonly projectId: string;
      readonly relativeRoot?: string;
      readonly signal?: AbortSignal;
    }
  | { readonly kind: 'upload:begin'; readonly projectId: string }
  | { readonly kind: 'export:manifest'; readonly projectId: string }
  | { readonly kind: 'artifact:save'; readonly request: unknown }
  | { readonly kind: 'artifact:lint'; readonly request: unknown }
  | { readonly kind: 'artifact:download'; readonly artifactId: string }
  | {
      readonly kind: 'journal:mutate';
      readonly scope:
        | { readonly kind: 'run'; readonly runId: string }
        | { readonly kind: 'project'; readonly projectId: string };
      readonly execute: () => Promise<{
        readonly events: readonly HostedDurableEventInput[];
        readonly value: unknown;
      }>;
    }
  | {
      readonly kind: 'journal:publish';
      readonly channel: HostedEventChannel;
      readonly event: string;
      readonly data: unknown;
    }
  | {
      readonly kind: 'journal:replay';
      readonly channel: HostedEventChannel;
      readonly after?: string | null;
    }
  | {
      readonly kind: 'journal:attach';
      readonly channel: HostedEventChannel;
      readonly after?: string | null;
      readonly response: Parameters<ReturnType<typeof createHostedEventJournal>['attach']>[0]['response'];
    }
  | { readonly kind: 'journal:close'; readonly channel: HostedEventChannel }
  | { readonly kind: 'journal:invalidate'; readonly channel: HostedEventChannel };

export interface HostedRuntimeUploadIntake {
  readonly stagingRoot: string;
  cleanup(): Promise<void>;
  finalize(input: {
    readonly fields: Readonly<Record<string, unknown>>;
    readonly files: readonly HostedMultipartFileDescriptor[];
  }): Promise<{ readonly files: readonly HostedUploadedFile[] }>;
}

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
  readonly kind: 'credential' | 'mutation' | 'run' | 'snapshot';
  readonly reject: (reason: unknown) => void;
  admissionTimer: ReturnType<typeof setTimeout> | null;
}

interface RunQueueEntry extends QueueEntryBase {
  readonly kind: 'run';
  readonly ownedRun: ReturnType<ReturnType<typeof createChatRunService>['create']>;
  readonly execute: HostedRunDispatch<unknown>['execute'];
  readonly journal: RunJournalPlan | null;
  readonly onTerminal?: HostedRunDispatch<unknown>['onTerminal'];
  readonly resolve: (value: unknown) => void;
  terminalError: HostedRuntimeError | null;
}

interface CredentialQueueEntry extends QueueEntryBase {
  readonly kind: 'credential';
  readonly credential: HostedProviderCredential | null;
  readonly resolve: (value: HostedProviderCredentialStatus) => void;
}

interface SnapshotQueueEntry extends QueueEntryBase {
  readonly kind: 'snapshot';
  readonly quiesce: () => Promise<void>;
  readonly resolve: (value: {
    readonly sequence: string;
    readonly bytes: number;
    readonly fileCount: number;
  }) => void;
}

interface MutationQueueEntry extends QueueEntryBase {
  readonly kind: 'mutation';
  readonly durable: boolean;
  readonly execute: () => unknown;
  readonly resolve: (value: unknown) => void;
}

type QueueEntry = RunQueueEntry | CredentialQueueEntry | MutationQueueEntry | SnapshotQueueEntry;

interface ActiveRun {
  readonly entry: RunQueueEntry;
  readonly abort: AbortController;
  readonly countsAsChild: boolean;
  eventTail: Promise<void>;
  timeout: ReturnType<typeof setTimeout> | null;
  terminalError: HostedRuntimeError | null;
}

interface RunJournalPlan {
  readonly mapEvent: (
    channel: string,
    payload: Record<string, unknown>,
  ) => readonly HostedRunJournalEventSpec[];
  terminalValue: HostedPiTurnResult['value'] | null;
}

interface RuntimeState {
  readonly binding: IdentityBinding;
  readonly generation: number;
  readonly ready: Promise<void>;
  readonly sessions: Map<string, string>;
  readonly snapshotStore: HostedSnapshotStore;
  readonly queue: QueueEntry[];
  active: ActiveRun | null;
  artifactAdapter: HostedArtifactAdapter | null;
  checkpointService: ProjectCheckpointService | null;
  credential: HostedProviderCredential | null;
  durability: HostedDurabilityCoordinator | null;
  eventJournal: ReturnType<typeof createHostedEventJournal> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
  initializationError: HostedRuntimeError | null;
  lifecycle: 'initializing' | 'active' | 'cleaning' | 'poisoned' | 'closed';
  resolveReady: () => void;
  retirementPromise: Promise<void> | null;
  runService: ReturnType<typeof createChatRunService> | null;
  runReceipts: HostedRunReceiptStore | null;
  sessionReferenceBytes: number;
  laneOperationActive: boolean;
  storage: HostedRuntimeStorage | null;
  strongLeases: number;
}

const DEFAULT_IDLE_EVICTION_MS = 5 * 60_000;
const DEFAULT_ADMISSION_TIMEOUT_MS = 30_000;
const DEFAULT_RUN_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 60_000;
const EVENT_JOURNAL_SNAPSHOT = '.hosted-event-journal.json';

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
  const createSnapshotStore = options.createSnapshotStore ?? createHostedSnapshotStore;
  const contentQuota = createHostedContentQuota();
  const downloadStreams = createHostedDownloadStreams();
  const eventBudget = createHostedEventBudget(options.eventBudgetLimits);
  const eventGenerationNonce = randomUUID();
  const createEntityId = options.createEntityId ?? (() => randomUUID());
  const projectCatalogueIds = options.projectCatalogueIds ?? new Set<string>();
  const skillCatalogueIds = options.skillCatalogueIds ?? new Set<string>();
  const designSystemCatalogueIds = options.designSystemCatalogueIds ?? new Set<string>();
  const startTurn = options.startTurn ?? (async (input: HostedPiTurnInput) => {
    const module = await import('./runtimes/hosted-pi-turn.js');
    return module.startHostedPiTurn(input);
  });
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
      if (existing.lifecycle === 'initializing' || existing.lifecycle === 'active') return existing;
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
    try {
      const generation = binding.nextGeneration + 1;
      const identity = {
        storageKey: binding.storageKey,
        userKey: binding.userKey,
      };
      const snapshotStore = createSnapshotStore({
        identity,
        runtimeRoot,
      });
      let resolveReady!: () => void;
      const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
      const runtime: RuntimeState = {
        active: null,
        artifactAdapter: null,
        binding,
        checkpointService: null,
        credential: null,
        durability: null,
        eventJournal: null,
        generation,
        idleTimer: null,
        initializationError: null,
        lifecycle: 'initializing',
        queue: [],
        ready,
        resolveReady,
        retirementPromise: null,
        runService: null,
        runReceipts: null,
        sessionReferenceBytes: 0,
        sessions: new Map(),
        laneOperationActive: false,
        snapshotStore,
        storage: null,
        strongLeases: 0,
      };
      binding.nextGeneration = generation;
      runtimes.set(binding.userKey, runtime);
      void initializeRuntime(runtime, identity);
      return runtime;
    } catch {
      throw new HostedRuntimeError(
        'HOSTED_RUNTIME_UNAVAILABLE',
        'hosted runtime initialization failed',
      );
    }
  }

  async function initializeRuntime(
    runtime: RuntimeState,
    identity: { readonly storageKey: string; readonly userKey: string },
  ): Promise<void> {
    let storage: HostedRuntimeStorage | null = null;
    let runService: ReturnType<typeof createChatRunService> | null = null;
    let artifactAdapter: HostedArtifactAdapter | null = null;
    let eventJournal: ReturnType<typeof createHostedEventJournal> | null = null;
    try {
      const restored = await runtime.snapshotStore.restore();
      storage = restored?.storage ?? createStorage({ identity, runtimeRoot });
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
      artifactAdapter = createHostedArtifactAdapter({
        artifactsRoot: storage.roots.artifactsRoot,
      });
      const runReceipts = createHostedRunReceiptStore(storage.database, {
        maxReceipts: limits.retainedRunsPerUser,
      });
      const journalRestore = readEventJournalSnapshot(storage);
      eventJournal = createHostedEventJournal({
        budget: eventBudget,
        generation: `${eventGenerationNonce}-${runtime.generation}`,
        ownerKey: runtime.binding.storageKey,
        ...(options.eventBudgetLimits === undefined
          ? {}
          : { limits: options.eventBudgetLimits }),
        ...(journalRestore === undefined ? {} : { restore: journalRestore }),
      });
      const activeStorage = storage;
      const durability = createHostedDurabilityCoordinator({
        publish: async (signal) => {
          if (signal.aborted) throw signal.reason;
          return runtime.snapshotStore.publish({
            quiesce: async () => {},
            signal,
            storage: activeStorage,
          });
        },
        poison(error) {
          const mapped = durabilityError(error);
          if (runtime.lifecycle === 'active') poisonRuntime(runtime, mapped);
          else runtime.initializationError = mapped;
        },
        requestIdleFlush(flush) {
          void enqueueMutation(runtime, flush, false).catch(() => {});
        },
      });
      if (runReceipts.reconcileInterrupted() > 0) {
        durability.markDirty();
        await durability.flush();
      }
      hydrateRunReceipts(runService, runReceipts.list());
      hydrateSessionReferences(runtime, storage, limits);
      if (
        runtimes.get(runtime.binding.userKey) !== runtime
        || runtime.lifecycle !== 'initializing'
      ) {
        closeInitializationResources(runService, storage, artifactAdapter, eventJournal);
        return;
      }
      runtime.checkpointService = checkpointService;
      runtime.artifactAdapter = artifactAdapter;
      runtime.durability = durability;
      runtime.eventJournal = eventJournal;
      runtime.runService = runService;
      runtime.runReceipts = runReceipts;
      runtime.storage = storage;
      runtime.lifecycle = 'active';
      storage = null;
      runService = null;
      artifactAdapter = null;
      eventJournal = null;
    } catch {
      runtime.artifactAdapter = artifactAdapter;
      runtime.eventJournal = eventJournal;
      runtime.runService = runService;
      runtime.storage = storage;
      runtime.initializationError = new HostedRuntimeError(
        'HOSTED_RUNTIME_UNAVAILABLE',
        'hosted runtime initialization failed',
      );
      runtime.lifecycle = 'poisoned';
    } finally {
      runtime.resolveReady();
      if (runtime.lifecycle === 'active') {
        pump(runtime);
        scheduleIdleEviction(runtime);
      } else if (runtime.lifecycle === 'poisoned') {
        retirePoisoned(runtime);
      }
      tryFinishShutdown();
    }
  }

  function closeInitializationResources(
    runService: ReturnType<typeof createChatRunService> | null,
    storage: HostedRuntimeStorage | null,
    artifactAdapter?: HostedArtifactAdapter | null,
    eventJournal?: ReturnType<typeof createHostedEventJournal> | null,
  ): void {
    try {
      eventJournal?.dispose();
    } catch {
      // Initialization remains failed even when a partial resource cannot close.
    }
    try {
      artifactAdapter?.dispose();
    } catch {
      // Initialization remains failed even when a partial resource cannot close.
    }
    try {
      runService?.dispose();
    } catch {
      // Initialization remains failed even when a partial resource cannot close.
    }
    try {
      storage?.close();
    } catch {
      // Never leave readiness unsettled or a failed generation initializing.
    }
  }

  async function waitForRuntime(runtime: RuntimeState): Promise<void> {
    if (runtime.lifecycle === 'initializing') await runtime.ready;
    assertRuntimeAvailable(runtime);
  }

  function assertRuntimeAvailable(runtime: RuntimeState): void {
    if (
      shuttingDown
      || runtime.initializationError != null
      || runtime.lifecycle !== 'active'
      || runtimes.get(runtime.binding.userKey) !== runtime
    ) {
      runtimeUnavailable('hosted runtime generation is unavailable');
    }
  }

  function storageFor(runtime: RuntimeState): HostedRuntimeStorage {
    if (runtime.storage == null) runtimeUnavailable('hosted runtime storage is unavailable');
    return runtime.storage;
  }

  function runServiceFor(runtime: RuntimeState): ReturnType<typeof createChatRunService> {
    if (runtime.runService == null) runtimeUnavailable('hosted run service is unavailable');
    return runtime.runService;
  }

  function checkpointServiceFor(runtime: RuntimeState): ProjectCheckpointService {
    if (runtime.checkpointService == null) {
      runtimeUnavailable('hosted checkpoint service is unavailable');
    }
    return runtime.checkpointService;
  }

  function artifactAdapterFor(runtime: RuntimeState): HostedArtifactAdapter {
    if (runtime.artifactAdapter == null) {
      runtimeUnavailable('hosted artifact adapter is unavailable');
    }
    return runtime.artifactAdapter;
  }

  function durabilityFor(runtime: RuntimeState): HostedDurabilityCoordinator {
    if (runtime.durability == null) {
      runtimeUnavailable('hosted durability coordinator is unavailable');
    }
    return runtime.durability;
  }

  function eventJournalFor(
    runtime: RuntimeState,
  ): ReturnType<typeof createHostedEventJournal> {
    if (runtime.eventJournal == null) {
      runtimeUnavailable('hosted event journal is unavailable');
    }
    return runtime.eventJournal;
  }

  function runReceiptsFor(runtime: RuntimeState): HostedRunReceiptStore {
    if (runtime.runReceipts == null) {
      runtimeUnavailable('hosted run receipt store is unavailable');
    }
    return runtime.runReceipts;
  }

  function acquireStrong(runtime: RuntimeState): void {
    if (runtime.lifecycle !== 'initializing' && runtime.lifecycle !== 'active') {
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
    } else if (runtime.lifecycle === 'active') {
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
    return dispatchRun(lease, operation, null);
  }

  function dispatchRun<T>(
    lease: HostedRuntimeLease,
    operation: HostedRunDispatch<T>,
    journal: RunJournalPlan | null,
  ): Promise<T> {
    let runtime: RuntimeState;
    try {
      if (shuttingDown) runtimeUnavailable('hosted runtime registry is shutting down');
      const state = stateForLease(lease, 'strong');
      validateInternalId(operation.runId, 'run');
      validateInternalId(operation.conversationId, 'conversation');
      runtime = state.runtime;
      acquireStrong(runtime);
    } catch (error) {
      return Promise.reject(error);
    }
    return enqueueRunAfterReady(runtime, operation, journal);
  }

  async function enqueueRunAfterReady<T>(
    runtime: RuntimeState,
    operation: HostedRunDispatch<T>,
    journal: RunJournalPlan | null,
  ): Promise<T> {
    try {
      if (runtime.lifecycle === 'initializing') await waitForRuntime(runtime);
      else assertRuntimeAvailable(runtime);
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
      const runService = runServiceFor(runtime);
      if (runService.list().length >= limits.retainedRunsPerUser) {
        throw new HostedRuntimeError('HOSTED_OVERLOADED', 'hosted retained run capacity is exhausted');
      }
      const ownedRun = runService.createWithId(operation.runId, {
        conversationId: operation.conversationId,
        ...(operation.projectId === undefined ? {} : { projectId: operation.projectId }),
        ...(operation.assistantMessageId === undefined
          ? {}
          : { assistantMessageId: operation.assistantMessageId }),
        ...(operation.agentId === undefined ? {} : { agentId: operation.agentId }),
        ...(operation.clientRequestId === undefined
          ? {}
          : { clientRequestId: operation.clientRequestId }),
      });

      return new Promise<T>((resolve, reject) => {
        const entry: RunQueueEntry = {
          admissionTimer: null,
          execute: operation.execute as HostedRunDispatch<unknown>['execute'],
          journal,
          kind: 'run',
          ...(operation.onTerminal === undefined ? {} : { onTerminal: operation.onTerminal }),
          ownedRun,
          reject,
          resolve: resolve as (value: unknown) => void,
          terminalError: null,
        };
        runtime.queue.push(entry);
        queuedMutations += 1;
        entry.admissionTimer = unrefTimer(setTimeout(() => {
          const code = runtime.active == null && !runtime.laneOperationActive
            ? 'HOSTED_CAPACITY_EXHAUSTED'
            : 'HOSTED_OVERLOADED';
          terminateQueuedRun(runtime, entry, new HostedRuntimeError(
            code,
            'hosted run admission timed out',
          ));
        }, admissionTimeoutMs));
        operation.onAdmitted?.();
        pump(runtime);
      });
    } catch (error) {
      releaseStrong(runtime);
      throw error;
    }
  }

  function credentialStatus(lease: HostedRuntimeLease): HostedProviderCredentialStatus {
    return statusForCredential(stateForLease(lease).runtime.credential);
  }

  function replaceCredential(
    lease: HostedRuntimeLease,
    credential: HostedProviderCredential | null,
  ): Promise<HostedProviderCredentialStatus> {
    let runtime: RuntimeState;
    let nextCredential: HostedProviderCredential | null;
    try {
      if (shuttingDown) runtimeUnavailable('hosted runtime registry is shutting down');
      const state = stateForLease(lease, 'strong');
      nextCredential = credential == null ? null : validateHostedProviderCredential(credential);
      runtime = state.runtime;
      acquireStrong(runtime);
    } catch (error) {
      return Promise.reject(error);
    }
    return enqueueCredentialAfterReady(runtime, nextCredential);
  }

  async function enqueueCredentialAfterReady(
    runtime: RuntimeState,
    nextCredential: HostedProviderCredential | null,
  ): Promise<HostedProviderCredentialStatus> {
    try {
      if (runtime.lifecycle === 'initializing') await waitForRuntime(runtime);
      else assertRuntimeAvailable(runtime);
      if (runtime.queue.length >= limits.queuedMutationsPerUser) {
        throw new HostedRuntimeError('HOSTED_OVERLOADED', 'hosted user mutation queue is full');
      }
      if (queuedMutations >= limits.queuedMutationsGlobal) {
        throw new HostedRuntimeError(
          'HOSTED_CAPACITY_EXHAUSTED',
          'hosted process mutation queue is full',
        );
      }

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
            runtime.active == null && !runtime.laneOperationActive
              ? 'HOSTED_CAPACITY_EXHAUSTED'
              : 'HOSTED_OVERLOADED',
            'hosted credential mutation admission timed out',
          ));
        }, admissionTimeoutMs));
        pump(runtime);
      });
    } catch (error) {
      releaseStrong(runtime);
      throw error;
    }
  }

  function enqueueMutation(
    runtime: RuntimeState,
    execute: () => unknown,
    durable = true,
  ): Promise<unknown> {
    try {
      acquireStrong(runtime);
    } catch (error) {
      return Promise.reject(error);
    }
    return enqueueMutationAfterReady(runtime, execute, durable);
  }

  async function enqueueMutationAfterReady(
    runtime: RuntimeState,
    execute: () => unknown,
    durable: boolean,
  ): Promise<unknown> {
    try {
      if (runtime.lifecycle === 'initializing') await waitForRuntime(runtime);
      else assertRuntimeAvailable(runtime);
      if (runtime.queue.length >= limits.queuedMutationsPerUser) {
        throw new HostedRuntimeError('HOSTED_OVERLOADED', 'hosted user mutation queue is full');
      }
      if (queuedMutations >= limits.queuedMutationsGlobal) {
        throw new HostedRuntimeError(
          'HOSTED_CAPACITY_EXHAUSTED',
          'hosted process mutation queue is full',
        );
      }
      return new Promise((resolve, reject) => {
        const entry: MutationQueueEntry = {
          admissionTimer: null,
          durable,
          execute,
          kind: 'mutation',
          reject,
          resolve,
        };
        runtime.queue.push(entry);
        queuedMutations += 1;
        entry.admissionTimer = unrefTimer(setTimeout(() => {
          removeQueued(runtime, entry, new HostedRuntimeError(
            runtime.active == null && !runtime.laneOperationActive
              ? 'HOSTED_CAPACITY_EXHAUSTED'
              : 'HOSTED_OVERLOADED',
            'hosted mutation admission timed out',
          ));
        }, admissionTimeoutMs));
        pump(runtime);
      });
    } catch (error) {
      releaseStrong(runtime);
      throw error;
    }
  }

  function publishSnapshot(
    runtime: RuntimeState,
    quiesce: () => Promise<void>,
  ): Promise<{ readonly sequence: string; readonly bytes: number; readonly fileCount: number }> {
    try {
      acquireStrong(runtime);
    } catch (error) {
      return Promise.reject(error);
    }
    return enqueueSnapshotAfterReady(runtime, quiesce);
  }

  async function enqueueSnapshotAfterReady(
    runtime: RuntimeState,
    quiesce: () => Promise<void>,
  ): Promise<{ readonly sequence: string; readonly bytes: number; readonly fileCount: number }> {
    try {
      if (runtime.lifecycle === 'initializing') await waitForRuntime(runtime);
      else assertRuntimeAvailable(runtime);
      if (runtime.queue.length >= limits.queuedMutationsPerUser) {
        throw new HostedRuntimeError('HOSTED_OVERLOADED', 'hosted user mutation queue is full');
      }
      if (queuedMutations >= limits.queuedMutationsGlobal) {
        throw new HostedRuntimeError(
          'HOSTED_CAPACITY_EXHAUSTED',
          'hosted process mutation queue is full',
        );
      }
      return new Promise((resolve, reject) => {
        const entry: SnapshotQueueEntry = {
          admissionTimer: null,
          kind: 'snapshot',
          quiesce,
          reject,
          resolve,
        };
        runtime.queue.push(entry);
        queuedMutations += 1;
        entry.admissionTimer = unrefTimer(setTimeout(() => {
          removeQueued(runtime, entry, new HostedRuntimeError(
            runtime.active == null && !runtime.laneOperationActive
              ? 'HOSTED_CAPACITY_EXHAUSTED'
              : 'HOSTED_OVERLOADED',
            'hosted snapshot publication admission timed out',
          ));
        }, admissionTimeoutMs));
        pump(runtime);
      });
    } catch (error) {
      releaseStrong(runtime);
      throw error;
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
      || (
        state.runtime.lifecycle !== 'initializing'
        && state.runtime.lifecycle !== 'active'
      )
    ) {
      runtimeUnavailable('hosted runtime lease is not active');
    }
    return state;
  }

  function pump(runtime: RuntimeState): void {
    if (
      (shuttingDown && !isQueuedJournaledTerminal(runtime.queue[0]))
      || runtime.lifecycle !== 'active'
      || runtime.active != null
      || runtime.laneOperationActive
      || runtime.queue.length === 0
    ) return;
    const next = runtime.queue[0];
    if (
      next?.kind === 'run'
      && next.terminalError == null
      && activeChildren >= limits.activeChildren
    ) return;
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
    if (entry.kind === 'snapshot') {
      runtime.laneOperationActive = true;
      void runtime.snapshotStore.publish({
        quiesce: entry.quiesce,
        storage: storageFor(runtime),
      }).then(
        (publication) => {
          runtime.laneOperationActive = false;
          releaseStrong(runtime);
          entry.resolve({
            bytes: publication.bytes,
            fileCount: publication.fileCount,
            sequence: publication.sequence,
          });
          pump(runtime);
          pumpAll();
          scheduleIdleEviction(runtime);
          tryFinishShutdown();
        },
        (cause) => {
          runtime.laneOperationActive = false;
          const error = new HostedRuntimeError(
            cause instanceof HostedSnapshotError
              ? cause.code
              : 'HOSTED_RUNTIME_UNAVAILABLE',
            'hosted snapshot publication failed',
          );
          poisonRuntime(runtime, error);
          releaseStrong(runtime);
          entry.reject(error);
          pumpAll();
          tryFinishShutdown();
        },
      );
      return;
    }
    if (entry.kind === 'mutation') {
      runtime.laneOperationActive = true;
      const work = entry.durable
        ? () => durabilityFor(runtime).mutate(entry.execute)
        : () => Promise.resolve().then(entry.execute);
      void work().then(entry.resolve, (cause: unknown) => {
        entry.reject(cause instanceof HostedDurabilityError ? durabilityError(cause) : cause);
      }).finally(() => {
        runtime.laneOperationActive = false;
        releaseStrong(runtime);
        pump(runtime);
        pumpAll();
        scheduleIdleEviction(runtime);
        tryFinishShutdown();
      });
      return;
    }
    const abort = new AbortController();
    const active: ActiveRun = {
      abort,
      countsAsChild: entry.terminalError == null,
      entry,
      eventTail: Promise.resolve(),
      terminalError: entry.terminalError,
      timeout: null,
    };
    runtime.active = active;
    if (active.countsAsChild) activeChildren += 1;
    if (active.terminalError != null) {
      void finishRun(runtime, active, null, active.terminalError);
      return;
    }
    active.timeout = unrefTimer(setTimeout(() => {
      if (runtime.active !== active || active.terminalError != null) return;
      active.terminalError = new HostedRuntimeError(
        'HOSTED_RUN_TIMED_OUT',
        'hosted run exceeded its execution deadline',
      );
      abort.abort(active.terminalError);
    }, runTimeoutMs));
    if (entry.journal == null) {
      markRunRunning(runtime, entry);
      void executeActiveRun(runtime, active);
    } else {
      void startJournaledRun(runtime, active);
    }
  }

  function markRunRunning(runtime: RuntimeState, entry: RunQueueEntry): void {
    entry.ownedRun.status = 'running';
    entry.ownedRun.updatedAt = Date.now();
    runServiceFor(runtime).emit(entry.ownedRun, 'start', {
      conversationId: entry.ownedRun.conversationId,
      runId: entry.ownedRun.id,
      status: 'running',
    });
  }

  async function startJournaledRun(runtime: RuntimeState, active: ActiveRun): Promise<void> {
    const journal = active.entry.journal!;
    try {
      const events = requiredRunEvents(
        active.entry.ownedRun.id,
        journal,
        'status-transition',
        'started',
      );
      const prepared = await persistDurableEvents(runtime, events, () => {
        const clientRequestId = active.entry.ownedRun.clientRequestId;
        if (typeof clientRequestId !== 'string' || clientRequestId.length === 0) {
          runtimeUnavailable('hosted journaled run receipt is unavailable');
        }
        if (runReceiptsFor(runtime).updateStatus(clientRequestId, 'running') == null) {
          runtimeUnavailable('hosted journaled run receipt is unavailable');
        }
      });
      commitDurableEvents(runtime, prepared, 'hosted running event publication failed');
      markRunRunning(runtime, active.entry);
      active.abort.signal.throwIfAborted();
      await executeActiveRun(runtime, active);
    } catch (error) {
      await finishRun(runtime, active, null, error);
    }
  }

  async function executeActiveRun(runtime: RuntimeState, active: ActiveRun): Promise<void> {
    const sessionReference = runtime.sessions.get(active.entry.ownedRun.conversationId) ?? null;
    let result: HostedRunExecutionResult<unknown>;
    try {
      result = await active.entry.execute({
        credential: runtime.credential,
        sessionReference,
        signal: active.abort.signal,
      });
    } catch (error) {
      await finishRun(runtime, active, null, error);
      return;
    }
    await finishRun(runtime, active, result, null);
  }

  async function persistDurableEvents(
    runtime: RuntimeState,
    events: readonly HostedRunJournalEventSpec[],
    mutation: () => unknown,
  ): Promise<HostedPreparedDurableEventBatch> {
    const journal = eventJournalFor(runtime);
    const batch = journal.prepareDurableBatch(events.map((event) => ({
      channel: event.channel,
      data: event.data,
      event: event.event,
      milestone: event.milestone!,
    })));
    let mutationStarted = false;
    try {
      await durabilityFor(runtime).mutate(async () => {
        mutationStarted = true;
        await mutation();
        writeEventJournalSnapshot(storageFor(runtime), batch.snapshot);
      });
      return batch;
    } catch (error) {
      batch.rollback();
      if (mutationStarted && !(error instanceof HostedDurabilityError)) {
        poisonRuntime(runtime, new HostedRuntimeError(
          'HOSTED_RUNTIME_UNAVAILABLE',
          'hosted durable event mutation failed',
        ));
      }
      throw error;
    }
  }

  function commitDurableEvents(
    runtime: RuntimeState,
    batch: HostedPreparedDurableEventBatch,
    message: string,
  ): void {
    try {
      batch.commit();
    } catch {
      batch.rollback();
      const error = new HostedRuntimeError('HOSTED_RUNTIME_UNAVAILABLE', message);
      poisonRuntime(runtime, error);
      throw error;
    }
  }

  function requiredRunEvents(
    runId: string,
    journal: RunJournalPlan,
    milestone: Exclude<HostedDurableEventMilestone, 'resync'>,
    status: 'created' | 'started' | 'completed' | 'failed' | 'cancelled',
    error?: unknown,
  ): readonly HostedRunJournalEventSpec[] {
    const payload: Record<string, unknown> = {
      kind: 'run.lifecycle',
      runId,
      status,
      ts: Date.now(),
    };
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      payload.exitCode = journal.terminalValue?.exitCode ?? (status === 'completed' ? 0 : null);
      payload.signal = journal.terminalValue?.signal ?? null;
      if (error != null) {
        payload.errorCode = error instanceof HostedRuntimeError ? error.code : 'INTERNAL_ERROR';
      }
    }
    const events = validateRunEvents(runId, journal.mapEvent('run.lifecycle', payload));
    if (
      events.length === 0
      || events.some((event) => event.milestone == null)
      || !events.some((event) => (
        event.milestone === milestone
        && (milestone === 'status-transition' || event.channel.kind === 'run')
      ))
    ) {
      runtimeUnavailable(`hosted ${status} event mapping is not durable`);
    }
    return events;
  }

  function validateRunEvents(
    runId: string,
    input: readonly HostedRunJournalEventSpec[],
  ): readonly HostedRunJournalEventSpec[] {
    if (!Array.isArray(input)) runtimeUnavailable('hosted run event mapping is invalid');
    for (const event of input) {
      if (
        event == null
        || typeof event !== 'object'
        || (event.channel.kind !== 'run' && event.channel.kind !== 'run-ui')
        || event.channel.runId !== runId
      ) {
        runtimeUnavailable('hosted run event mapping escaped its run authority');
      }
    }
    return input;
  }

  function queueRunEvents(
    runtime: RuntimeState,
    journal: RunJournalPlan,
    channel: string,
    payload: Record<string, unknown>,
  ): void {
    const active = runtime.active;
    if (active == null || active.entry.journal !== journal) return;
    let events: readonly HostedRunJournalEventSpec[];
    try {
      events = validateRunEvents(active.entry.ownedRun.id, journal.mapEvent(channel, payload));
    } catch (error) {
      events = [];
      active.eventTail = active.eventTail.then(() => Promise.reject(error));
    }
    if (events.length > 0) {
      active.eventTail = active.eventTail.then(() => publishRunEvents(runtime, events));
    }
    void active.eventTail.catch((cause: unknown) => {
      if (runtime.active !== active) return;
      const error = cause instanceof HostedDurabilityError
        ? durabilityError(cause)
        : cause instanceof HostedRuntimeError
          ? cause
          : new HostedRuntimeError('HOSTED_RUNTIME_UNAVAILABLE', 'hosted run event failed');
      active.terminalError ??= error;
      active.abort.abort(active.terminalError);
    });
  }

  async function publishRunEvents(
    runtime: RuntimeState,
    events: readonly HostedRunJournalEventSpec[],
  ): Promise<void> {
    const journal = eventJournalFor(runtime);
    for (let index = 0; index < events.length;) {
      const event = events[index]!;
      if (event.milestone == null) {
        journal.publish(event.channel, event.event, event.data);
        index += 1;
        continue;
      }
      const durable: HostedRunJournalEventSpec[] = [];
      while (events[index]?.milestone != null) {
        durable.push(events[index]!);
        index += 1;
      }
      const batch = await persistDurableEvents(runtime, durable, () => {});
      commitDurableEvents(runtime, batch, 'hosted run event publication failed');
    }
  }

  async function finishRun(
    runtime: RuntimeState,
    active: ActiveRun,
    result: HostedRunExecutionResult<unknown> | null,
    executionError: unknown,
  ): Promise<void> {
    if (runtime.active !== active) return;
    clearTimer(active.timeout);
    let error = active.terminalError ?? executionError;
    const clientRequestId = active.entry.ownedRun.clientRequestId;
    const hasDurableTerminalState = (
      error == null && result?.sessionReference !== undefined
    ) || (typeof clientRequestId === 'string' && clientRequestId.length > 0);
    let terminalBatch: HostedPreparedDurableEventBatch | null = null;
    try {
      if (active.entry.journal != null) {
        try {
          await active.eventTail;
        } catch (eventError) {
          error = active.terminalError ?? eventError;
        }
        const events = requiredRunEvents(
          active.entry.ownedRun.id,
          active.entry.journal,
          'terminal',
          error == null
            ? 'completed'
            : error instanceof HostedRuntimeError && error.code === 'HOSTED_RUN_CANCELED'
              ? 'cancelled'
              : 'failed',
          error,
        );
        terminalBatch = await persistDurableEvents(
          runtime,
          events,
          () => applyTerminalState(runtime, active, result, error),
        );
      } else if (hasDurableTerminalState) await durabilityFor(runtime).mutate(
        () => applyTerminalState(runtime, active, result, error),
      );
    } catch (terminalError) {
      const poison = active.entry.journal != null
        || !(terminalError instanceof HostedRuntimeError);
      const terminalFailure = terminalError instanceof HostedDurabilityError
        ? durabilityError(terminalError)
        : terminalError instanceof HostedRuntimeError
          ? terminalError
          : new HostedRuntimeError(
          'HOSTED_RUNTIME_UNAVAILABLE',
          'hosted run terminal state could not be made durable',
        );
      error = terminalFailure;
      if (poison) poisonRuntime(runtime, terminalFailure);
    }
    if (error != null) runtime.credential = null;
    runtime.active = null;
    if (active.countsAsChild) activeChildren -= 1;
    const finalizationError = settleOwnedRun(runtime, active.entry, error);
    if (finalizationError != null) {
      terminalBatch?.rollback();
      terminalBatch = null;
      error = finalizationError;
      poisonRuntime(runtime, finalizationError);
    }
    if (terminalBatch != null) {
      try {
        terminalBatch.commit();
      } catch {
        const publicationError = new HostedRuntimeError(
          'HOSTED_RUNTIME_UNAVAILABLE',
          'hosted terminal event publication failed',
        );
        error = publicationError;
        poisonRuntime(runtime, publicationError);
      }
    }
    notifyRunTerminal(active.entry, error);
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

  function applyTerminalState(
    runtime: RuntimeState,
    active: ActiveRun,
    result: HostedRunExecutionResult<unknown> | null,
    error: unknown,
  ): void {
    const clientRequestId = active.entry.ownedRun.clientRequestId;
    if (error == null && result != null && result.sessionReference !== undefined) {
      const sessionReference = result.sessionReference;
      const conversationId = active.entry.ownedRun.conversationId;
      const previous = runtime.sessions.get(conversationId);
      const previousBytes = previous == null ? 0 : Buffer.byteLength(previous, 'utf8');
      if (sessionReference == null) {
        clearAgentSession(storageFor(runtime).database, conversationId, 'pi');
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
        const database = storageFor(runtime).database;
        if (getConversation(database, conversationId) != null) {
          upsertAgentSession(database, {
            agentId: 'pi',
            conversationId,
            sessionId: sessionReference,
          });
        }
        runtime.sessions.set(conversationId, sessionReference);
        runtime.sessionReferenceBytes = runtime.sessionReferenceBytes - previousBytes + nextBytes;
      }
    }
    if (typeof clientRequestId === 'string' && clientRequestId.length > 0) {
      if (runReceiptsFor(runtime).updateStatus(
        clientRequestId,
        error == null
          ? 'succeeded'
          : error instanceof HostedRuntimeError
            && error.code === 'HOSTED_RUN_CANCELED'
            ? 'canceled'
            : 'failed',
      ) == null) runtimeUnavailable('hosted journaled run receipt is unavailable');
    }
  }

  function settleOwnedRun(
    runtime: RuntimeState,
    entry: RunQueueEntry,
    error: unknown,
  ): HostedRuntimeError | null {
    try {
      const runService = runServiceFor(runtime);
      if (runService.isTerminal(entry.ownedRun.status)) return null;
      if (error == null) {
        runService.finish(entry.ownedRun, 'succeeded', 0, null);
        return null;
      }
      if (
        error instanceof HostedRuntimeError
        && error.code === 'HOSTED_RUN_CANCELED'
      ) {
        runService.finish(entry.ownedRun, 'canceled', null, 'SIGTERM');
        return null;
      }
      const code = error instanceof HostedRuntimeError ? error.code : 'INTERNAL_ERROR';
      const message = error instanceof Error ? error.message : String(error);
      runService.fail(entry.ownedRun, code, message);
      return null;
    } catch {
      return new HostedRuntimeError(
        'HOSTED_RUNTIME_UNAVAILABLE',
        'hosted run state finalization failed',
      );
    }
  }

  function notifyRunTerminal(entry: RunQueueEntry, error: unknown): void {
    try {
      entry.onTerminal?.(error ?? null);
    } catch {
      // A server-owned event sink cannot reopen a run after owned state settled.
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
    settleRun = true,
  ): boolean {
    const index = runtime.queue.indexOf(entry);
    if (index < 0) return false;
    runtime.queue.splice(index, 1);
    queuedMutations -= 1;
    clearTimer(entry.admissionTimer);
    entry.admissionTimer = null;
    const finalizationError = entry.kind === 'run' && settleRun
      ? settleOwnedRun(runtime, entry, error)
      : null;
    if (finalizationError != null) poisonRuntime(runtime, finalizationError);
    if (entry.kind === 'run' && settleRun) notifyRunTerminal(entry, finalizationError ?? error);
    releaseStrong(runtime);
    entry.reject(finalizationError ?? error);
    pump(runtime);
    return true;
  }

  function isQueuedJournaledTerminal(entry: QueueEntry | undefined): entry is RunQueueEntry {
    return entry?.kind === 'run' && entry.journal != null && entry.terminalError != null;
  }

  function terminateQueuedRun(
    runtime: RuntimeState,
    entry: RunQueueEntry,
    error: HostedRuntimeError,
  ): boolean {
    if (entry.journal == null) return removeQueued(runtime, entry, error);
    if (!runtime.queue.includes(entry)) return false;
    entry.terminalError ??= error;
    clearTimer(entry.admissionTimer);
    entry.admissionTimer = null;
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
    return queued == null ? false : terminateQueuedRun(runtime, queued, error);
  }

  function scheduleIdleEviction(runtime: RuntimeState): void {
    if (
      shuttingDown
      || runtime.lifecycle !== 'active'
      || runtime.strongLeases !== 0
      || runtime.active != null
      || runtime.laneOperationActive
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
        && !runtime.laneOperationActive
        && runtime.queue.length === 0
      ) {
        void beginRetire(runtime).catch(() => {
          // A failed user's cleanup stays published as poisoned. Timer failures
          // never escape into the daemon event loop or affect another runtime.
        });
      }
    }, idleEvictionMs));
  }

  function beginRetire(runtime: RuntimeState): Promise<void> {
    if (runtime.retirementPromise != null) return runtime.retirementPromise;
    if (
      runtimes.get(runtime.binding.userKey) !== runtime
      || runtime.lifecycle === 'closed'
      || runtime.lifecycle === 'cleaning'
      || runtime.lifecycle === 'initializing'
    ) return Promise.resolve();
    clearIdleTimer(runtime);
    runtime.lifecycle = 'cleaning';
    runtime.laneOperationActive = true;
    runtime.retirementPromise = (async () => {
      try {
        await durabilityFor(runtime).finalFlush();
      } catch (cause) {
        runtime.lifecycle = 'poisoned';
        throw cause instanceof HostedDurabilityError ? durabilityError(cause) : cause;
      } finally {
        runtime.laneOperationActive = false;
      }
      closeRuntime(runtime);
    })();
    return runtime.retirementPromise;
  }

  function closeRuntime(runtime: RuntimeState): void {
    const generation = runtime.generation;
    runtime.lifecycle = 'cleaning';
    runtime.sessions.clear();
    runtime.sessionReferenceBytes = 0;
    runtime.credential = null;
    const errors: unknown[] = [];
    try {
      runtime.eventJournal?.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      runtime.artifactAdapter?.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      runtime.runService?.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      runtime.storage?.close();
    } catch (error) {
      errors.push(error);
    }
    try {
      options.onGenerationRetired?.({
        generation,
        userKey: runtime.binding.userKey,
      });
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
      || runtime.laneOperationActive
      || runtime.queue.length !== 0
    ) return;
    try {
      closeRuntime(runtime);
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
    for (const entry of [...runtime.queue]) {
      removeQueued(runtime, entry, error, entry.kind !== 'run' || entry.journal == null);
    }
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
        || runtime.laneOperationActive
        || runtime.lifecycle === 'initializing'
        || runtime.queue.length !== 0
      ) return;
    }
    void Promise.all([...runtimes.values()].map(beginRetire)).then(
      () => {
        if (runtimes.size === 0) resolveShutdown();
      },
      () => {
        // A failed final publication keeps shutdown pending until its timeout.
      },
    );
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
      for (const entry of [...runtime.queue]) {
        if (entry.kind === 'run') terminateQueuedRun(runtime, entry, canceled);
        else removeQueued(runtime, entry, canceled);
      }
      if (runtime.active != null) {
        runtime.active.terminalError ??= canceled;
        runtime.active.abort.abort(runtime.active.terminalError);
      }
      pump(runtime);
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

  async function dispatchInternalOperation(
    lease: HostedRuntimeLease,
    operation: HostedRuntimeInternalOperation,
  ): Promise<unknown> {
    try {
      const state = stateForLease(
        lease,
        operation.kind === 'journal:attach' ? undefined : 'strong',
      );
      switch (operation.kind) {
        case 'project:insert': {
          validateInternalId(operation.project.id, 'project');
          return dispatch(lease, {
            conversationId: operation.conversationId,
            runId: operation.runId,
            execute: async () => {
              const project = insertProject(
                storageFor(state.runtime).database,
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
          await waitForRuntime(state.runtime);
          const project = getProject(storageFor(state.runtime).database, operation.projectId);
          return project == null ? null : { id: project.id, name: project.name };
        }
        case 'checkpoint:count': {
          validateInternalId(operation.projectId, 'project');
          await waitForRuntime(state.runtime);
          const checkpoints = checkpointServiceFor(state.runtime).listCheckpoints(
            operation.projectId,
            operation.conversationId,
          );
          return checkpoints.length;
        }
        case 'run:get': {
          validateInternalId(operation.runId, 'run');
          await waitForRuntime(state.runtime);
          const runService = runServiceFor(state.runtime);
          const run = runService.get(operation.runId);
          if (run == null) return null;
          return runService.statusBody(run);
        }
        case 'runs:list': {
          await waitForRuntime(state.runtime);
          if (operation.projectId !== undefined) {
            requireOwnedProject(state.runtime, operation.projectId);
          }
          if (operation.conversationId !== undefined) {
            const conversation = getConversation(
              storageFor(state.runtime).database,
              operation.conversationId,
            );
            if (conversation == null) {
              throw new HostedRuntimeError(
                'CONVERSATION_NOT_FOUND',
                'hosted conversation was not found',
              );
            }
            if (
              operation.projectId !== undefined
              && conversation.projectId !== operation.projectId
            ) {
              throw new HostedRuntimeError(
                'CONVERSATION_NOT_FOUND',
                'hosted conversation was not found',
              );
            }
          }
          const runService = runServiceFor(state.runtime);
          return {
            runs: runService.list({
              ...(operation.projectId === undefined
                ? {}
                : { projectId: operation.projectId }),
              ...(operation.conversationId === undefined
                ? {}
                : { conversationId: operation.conversationId }),
              ...(operation.status === undefined ? {} : { status: operation.status }),
            }).filter((run: { projectId?: unknown }) => typeof run.projectId === 'string')
              .map((run: unknown) => runService.statusBody(run)),
          };
        }
        case 'run:wait': {
          validateInternalId(operation.runId, 'run');
          await waitForRuntime(state.runtime);
          const runService = runServiceFor(state.runtime);
          const run = runService.get(operation.runId);
          return run == null ? null : runService.wait(run);
        }
        case 'run:mutate': {
          return enqueueMutation(state.runtime, () => {
            if (operation.scope.kind === 'project') {
              requireOwnedProject(state.runtime, operation.scope.projectId);
            } else {
              validateInternalId(operation.scope.runId, 'run');
              if (runServiceFor(state.runtime).get(operation.scope.runId) == null) {
                throw new HostedRuntimeError('NOT_FOUND', 'hosted run was not found');
              }
            }
            return operation.execute();
          });
        }
        case 'run:start': {
          await waitForRuntime(state.runtime);
          const intent = operation.intent;
          validateHostedRunIntentOwnership(state.runtime, intent);
          const journalPlan: RunJournalPlan = {
            mapEvent: operation.mapEvent,
            terminalValue: null,
          };
          let accepted: ReturnType<HostedRunReceiptStore['accept']>;
          const createdBatch: { value: HostedPreparedDurableEventBatch | null } = {
            value: null,
          };
          let createdMutationStarted = false;
          try {
            accepted = await enqueueMutation(state.runtime, async () => {
              const receipts = runReceiptsFor(state.runtime);
              const existing = receipts.get(intent.clientRequestId);
              if (existing == null) {
                if (state.runtime.credential == null) {
                  throw new HostedRuntimeError(
                    'HOSTED_PROVIDER_MISSING',
                    'hosted provider credential is not configured',
                  );
                }
                if (receipts.count() >= limits.retainedRunsPerUser) {
                  throw new HostedRuntimeError(
                    'HOSTED_OVERLOADED',
                    'hosted retained run capacity is exhausted',
                  );
                }
                const createdEvents = requiredRunEvents(
                  operation.runId,
                  journalPlan,
                  'run-created',
                  'created',
                );
                createdBatch.value = eventJournalFor(state.runtime).prepareDurableBatch(
                  createdEvents.map((event) => ({
                    channel: event.channel,
                    data: event.data,
                    event: event.event,
                    milestone: event.milestone!,
                  })),
                );
                createdMutationStarted = true;
                await checkpointServiceFor(state.runtime).captureCheckpoint({
                  conversationId: intent.conversationId,
                  kind: 'before_run',
                  messageId: intent.assistantMessageId,
                  projectId: intent.projectId,
                  runId: operation.runId,
                });
              }
              const result = receipts.accept({
                intent,
                result: {
                  assistantMessageId: intent.assistantMessageId,
                  conversationId: intent.conversationId,
                  runId: operation.runId,
                },
                routeKind: operation.routeKind ?? 'runs',
              });
              if (!result.existing && createdBatch.value != null) {
                writeEventJournalSnapshot(
                  storageFor(state.runtime),
                  createdBatch.value.snapshot,
                );
              }
              return result;
            }) as ReturnType<HostedRunReceiptStore['accept']>;
            if (createdBatch.value != null) {
              commitDurableEvents(
                state.runtime,
                createdBatch.value,
                'hosted run-created event publication failed',
              );
            }
          } catch (error) {
            createdBatch.value?.rollback();
            if (createdMutationStarted && state.runtime.lifecycle === 'active') {
              poisonRuntime(state.runtime, new HostedRuntimeError(
                'HOSTED_RUNTIME_UNAVAILABLE',
                'hosted run acceptance could not be made durable',
              ));
            }
            if (error instanceof HostedRunReceiptError) {
              throw new HostedRuntimeError(error.code, error.message);
            }
            throw error;
          }
          if (accepted.existing) return accepted.receipt.result;
          let admittedResolve!: () => void;
          let admittedReject!: (error: unknown) => void;
          const admitted = new Promise<void>((resolve, reject) => {
            admittedResolve = resolve;
            admittedReject = reject;
          });
          const completion = dispatchRun(lease, {
            runId: operation.runId,
            conversationId: intent.conversationId,
            projectId: intent.projectId,
            assistantMessageId: intent.assistantMessageId,
            agentId: intent.agentId,
            clientRequestId: intent.clientRequestId,
            onAdmitted: admittedResolve,
            execute: async ({ credential, sessionReference, signal }) => {
              validateHostedRunIntentOwnership(state.runtime, intent);
              if (credential == null) {
                throw new HostedRuntimeError(
                  'HOSTED_PROVIDER_MISSING',
                  'hosted provider credential is not configured',
                );
              }
              signal.throwIfAborted();
              const storage = storageFor(state.runtime);
              const projectRoot = exactOwnedProjectRoot(
                storage.roots.projectsRoot,
                intent.projectId,
              );
              const result = await startTurn({
                capabilities: {
                  generation: state.runtime.generation,
                  userKey: state.runtime.binding.userKey,
                  runId: operation.runId,
                  projectId: intent.projectId,
                  projectRoot,
                  brokerRoot: storage.roots.brokerRoot,
                  sessionRoot: storage.roots.sessionsRoot,
                  uploadRoot: storage.roots.uploadsRoot,
                  modelCatalogue: operation.modelCatalogue,
                  thinkingCatalogue: operation.thinkingCatalogue,
                  designSystemId: intent.designSystemId,
                },
                credential,
                prompt: intent.currentPrompt,
                model: operation.model,
                thinking: intent.reasoning,
                sessionReference,
                imagePaths: [],
                signal,
                send: (channel, payload) => queueRunEvents(
                  state.runtime,
                  journalPlan,
                  channel,
                  payload,
                ),
              });
              journalPlan.terminalValue = result.value;
              if (result.value.status === 'canceled') {
                throw new HostedRuntimeError('HOSTED_RUN_CANCELED', 'hosted run was canceled');
              }
              if (result.value.status === 'failed') {
                throw new HostedRuntimeError(
                  'INTERNAL_ERROR',
                  'hosted Pi turn failed',
                );
              }
              return {
                sessionReference: result.sessionReference,
                value: {
                  runId: operation.runId,
                  conversationId: intent.conversationId,
                  assistantMessageId: intent.assistantMessageId,
                },
              };
            },
          }, journalPlan);
          void completion.catch(admittedReject);
          await admitted;
          return {
            runId: operation.runId,
            conversationId: intent.conversationId,
            assistantMessageId: intent.assistantMessageId,
          };
        }
        case 'metadata:read': {
          await waitForRuntime(state.runtime);
          return executeMetadataRead(state.runtime, operation.operation);
        }
        case 'metadata:mutate': {
          return enqueueMutation(
            state.runtime,
            () => executeMetadataMutation(state.runtime, operation.operation),
          );
        }
        case 'snapshot:publish': {
          return publishSnapshot(state.runtime, operation.quiesce);
        }
        case 'content:dispatch': {
          await waitForRuntime(state.runtime);
          return executeContentDispatch(state.runtime, operation.request);
        }
        case 'archive:open': {
          validateInternalId(operation.projectId, 'project');
          await waitForRuntime(state.runtime);
          requireOwnedProject(state.runtime, operation.projectId);
          const storage = storageFor(state.runtime);
          return downloadStreams.openArchive({
            archiveName: operation.projectId,
            rootPath: exactOwnedProjectRoot(storage.roots.projectsRoot, operation.projectId),
            userKey: state.runtime.binding.userKey,
            ...(operation.relativeRoot === undefined
              ? {}
              : { relativeRoot: operation.relativeRoot }),
            ...(operation.signal === undefined ? {} : { signal: operation.signal }),
          });
        }
        case 'upload:begin': {
          validateInternalId(operation.projectId, 'project');
          await waitForRuntime(state.runtime);
          requireOwnedProject(state.runtime, operation.projectId);
          return createUploadIntake(state.runtime, operation.projectId);
        }
        case 'export:manifest': {
          validateInternalId(operation.projectId, 'project');
          await waitForRuntime(state.runtime);
          const project = requireOwnedProject(state.runtime, operation.projectId);
          const storage = storageFor(state.runtime);
          exactOwnedProjectRoot(storage.roots.projectsRoot, operation.projectId);
          try {
            return buildProjectExportManifestResponse({
              files: await listFiles(storage.roots.projectsRoot, operation.projectId),
              project,
              projectId: operation.projectId,
            });
          } catch (error) {
            throw projectContentError(error);
          }
        }
        case 'artifact:save': {
          return enqueueMutation(
            state.runtime,
            () => artifactAdapterFor(state.runtime).save(operation.request),
          );
        }
        case 'artifact:lint': {
          await waitForRuntime(state.runtime);
          return artifactAdapterFor(state.runtime).lint(operation.request);
        }
        case 'artifact:download': {
          await waitForRuntime(state.runtime);
          return artifactAdapterFor(state.runtime).openDownload(operation.artifactId);
        }
        case 'journal:mutate': {
          const pending: { value: HostedPreparedDurableEventBatch | null } = {
            value: null,
          };
          try {
            const value = await enqueueMutation(state.runtime, async () => {
              validateJournalMutationScope(state.runtime, operation.scope);
              const result = await operation.execute();
              validateJournalMutationEvents(state.runtime, operation.scope, result.events);
              pending.value = eventJournalFor(state.runtime).prepareDurableBatch(result.events);
              writeEventJournalSnapshot(
                storageFor(state.runtime),
                pending.value.snapshot,
              );
              return result.value;
            });
            if (pending.value == null) runtimeUnavailable('hosted journal mutation was not prepared');
            commitDurableEvents(
              state.runtime,
              pending.value,
              'hosted journal mutation publication failed',
            );
            return value;
          } catch (error) {
            pending.value?.rollback();
            throw error;
          }
        }
        case 'journal:publish': {
          await waitForRuntime(state.runtime);
          return eventJournalFor(state.runtime).publish(
            operation.channel,
            operation.event,
            operation.data,
          );
        }
        case 'journal:replay': {
          await waitForRuntime(state.runtime);
          return eventJournalFor(state.runtime).replay({
            ...(operation.after === undefined ? {} : { after: operation.after }),
            channel: operation.channel,
            ownerKey: state.runtime.binding.storageKey,
          });
        }
        case 'journal:attach': {
          await waitForRuntime(state.runtime);
          return eventJournalFor(state.runtime).attach({
            ...(operation.after === undefined ? {} : { after: operation.after }),
            channel: operation.channel,
            ownerKey: state.runtime.binding.storageKey,
            response: operation.response,
          });
        }
        case 'journal:close': {
          await waitForRuntime(state.runtime);
          eventJournalFor(state.runtime).close(operation.channel);
          return { ok: true };
        }
        case 'journal:invalidate': {
          await waitForRuntime(state.runtime);
          eventJournalFor(state.runtime).invalidate(operation.channel);
          return { ok: true };
        }
      }
    } catch (error) {
      return Promise.reject(error);
    }
  }

  async function executeContentDispatch(
    runtime: RuntimeState,
    request: unknown,
  ): Promise<unknown> {
    const authority = {
      generation: runtime.generation,
      userKey: runtime.binding.userKey,
    };
    return createHostedContentAdapter({
      read: (_authority, operation) => executeContentRead(runtime, operation),
      mutateInLane: (_authority, operation) => enqueueMutation(
        runtime,
        () => executeContentMutation(runtime, operation),
      ),
    }).dispatch(authority, request);
  }

  async function executeContentRead(
    runtime: RuntimeState,
    operation: HostedContentReadOperation,
  ): Promise<unknown> {
    requireOwnedProject(runtime, operation.projectId);
    const projectsRoot = storageFor(runtime).roots.projectsRoot;
    exactOwnedProjectRoot(projectsRoot, operation.projectId);
    try {
      switch (operation.kind) {
        case 'files.list':
          return await listFiles(projectsRoot, operation.projectId, {
            ...(operation.since === undefined ? {} : { since: operation.since }),
          });
        case 'file.read':
          return await readProjectFile(projectsRoot, operation.projectId, operation.path);
        case 'files.search':
          return await searchProjectFiles(projectsRoot, operation.projectId, operation.q, {
            max: operation.max,
            ...(operation.pattern === undefined ? {} : { pattern: operation.pattern }),
          });
        case 'folders.list':
          return await listProjectFolders(projectsRoot, operation.projectId);
      }
    } catch (error) {
      throw projectContentError(error);
    }
  }

  async function executeContentMutation(
    runtime: RuntimeState,
    operation: HostedContentMutationOperation,
  ): Promise<unknown> {
    requireOwnedProject(runtime, operation.projectId);
    const storage = storageFor(runtime);
    const projectRoot = exactOwnedProjectRoot(storage.roots.projectsRoot, operation.projectId);
    return contentQuota.runMutation({
      allWorkspaceRoots: activeProjectRoots(),
      operation: contentQuotaOperation(operation),
      workspaceRoot: projectRoot,
    }, async () => {
      try {
        switch (operation.kind) {
          case 'file.write':
            return {
              file: await writeProjectFile(
                storage.roots.projectsRoot,
                operation.projectId,
                operation.body.name,
                operation.body.content,
                {
                  expectedContentSha256: operation.body.expectedContentSha256,
                  overwrite: operation.body.overwrite,
                },
              ),
            };
          case 'file.rename':
            return await renameProjectFile(
              storage.roots.projectsRoot,
              operation.projectId,
              operation.body.from,
              operation.body.to,
            );
          case 'file.delete':
            await deleteProjectFile(
              storage.roots.projectsRoot,
              operation.projectId,
              operation.path,
            );
            return { ok: true };
          case 'folder.create':
            return {
              folder: await createProjectFolder(
                storage.roots.projectsRoot,
                operation.projectId,
                operation.body.path,
              ),
            };
          case 'folder.delete':
            await deleteProjectFolder(
              storage.roots.projectsRoot,
              operation.projectId,
              operation.body.path,
            );
            return { ok: true };
        }
      } catch (error) {
        throw projectContentError(error);
      }
    });
  }

  function contentQuotaOperation(
    operation: HostedContentMutationOperation,
  ): HostedContentQuotaOperation {
    switch (operation.kind) {
      case 'file.write':
        return {
          bytes: operation.body.content.length,
          kind: 'write',
          path: operation.body.name,
        };
      case 'file.rename':
        return { from: operation.body.from, kind: 'rename', to: operation.body.to };
      case 'file.delete':
        return { kind: 'delete', path: operation.path };
      case 'folder.create':
      case 'folder.delete':
        return { kind: operation.kind, path: operation.body.path };
    }
  }

  function activeProjectRoots(): string[] {
    const roots: string[] = [];
    for (const runtime of runtimes.values()) {
      if (runtime.lifecycle !== 'active' || runtime.storage == null) continue;
      for (const project of listProjects(runtime.storage.database)) {
        roots.push(exactOwnedProjectRoot(runtime.storage.roots.projectsRoot, project.id));
      }
    }
    return roots;
  }

  async function createUploadIntake(
    runtime: RuntimeState,
    projectId: string,
  ): Promise<HostedRuntimeUploadIntake> {
    const storage = storageFor(runtime);
    const intake = await beginHostedUploadIntake({ uploadsRoot: storage.roots.uploadsRoot });
    return Object.freeze({
      stagingRoot: intake.stagingRoot,
      cleanup: () => intake.cleanup(),
      finalize: ({ fields, files }: {
        readonly fields: Readonly<Record<string, unknown>>;
        readonly files: readonly HostedMultipartFileDescriptor[];
      }) => intake.finalize({
        commitInLane: async (commit) => {
          const bytes = files.reduce((total: number, file: HostedMultipartFileDescriptor) => (
            total + file.size
          ), 0);
          const result = await enqueueMutation(runtime, () => {
            requireOwnedProject(runtime, projectId);
            const projectRoot = exactOwnedProjectRoot(storage.roots.projectsRoot, projectId);
            return contentQuota.runMutation({
              allWorkspaceRoots: activeProjectRoots(),
              operation: { bytes, files: files.length, kind: 'growth' },
              workspaceRoot: projectRoot,
            }, commit);
          });
          return result as Awaited<ReturnType<typeof commit>>;
        },
        destinationRoot: exactOwnedProjectRoot(storage.roots.projectsRoot, projectId),
        fields,
        files,
      }),
    });
  }

  function executeMetadataRead(
    runtime: RuntimeState,
    operation: HostedMetadataReadOperation,
  ): unknown {
    const storage = storageFor(runtime);
    const db = storage.database;
    switch (operation.kind) {
      case 'projects.list':
        admitMetadataCount(db, 'projects', limits.metadataProjectsPerUser);
        return { projects: listProjects(db) };
      case 'project.get':
        return { project: requireOwnedProject(runtime, operation.projectId) };
      case 'conversations.list':
        requireOwnedProject(runtime, operation.projectId);
        admitMetadataCount(db, 'conversations', limits.metadataConversationsPerUser);
        return { conversations: listConversations(db, operation.projectId) };
      case 'messages.list':
        requireOwnedConversation(runtime, operation.projectId, operation.conversationId);
        admitMetadataCount(db, 'messages', limits.metadataMessagesPerUser);
        return {
          messages: listMessages(db, operation.conversationId).map(hostedMessageRow),
        };
      case 'comments.list':
        requireOwnedConversation(runtime, operation.projectId, operation.conversationId);
        admitMetadataCount(db, 'comments', limits.metadataCommentsPerUser);
        return {
          comments: listPreviewComments(
            db,
            operation.projectId,
            operation.conversationId,
          ),
        };
      case 'tabs.get':
        requireOwnedProject(runtime, operation.projectId);
        admitMetadataCount(db, 'tabs', limits.metadataTabsPerUser);
        return listTabs(db, operation.projectId);
      case 'checkpoints.list':
        requireOwnedProject(runtime, operation.projectId);
        if (operation.conversationId !== undefined) {
          requireOwnedConversation(runtime, operation.projectId, operation.conversationId);
        }
        return {
          checkpoints: checkpointServiceFor(runtime).listCheckpoints(
            operation.projectId,
            operation.conversationId,
          ),
        };
      case 'checkpoint.get':
        requireOwnedProject(runtime, operation.projectId);
        return {
          checkpoint: checkpointServiceFor(runtime).getCheckpoint(
            operation.projectId,
            operation.checkpointId,
          ),
        };
      case 'checkpoint.diff':
        requireOwnedProject(runtime, operation.projectId);
        return checkpointServiceFor(runtime).diffCheckpoint(
          operation.projectId,
          operation.checkpointId,
        );
    }
  }

  function executeMetadataMutation(
    runtime: RuntimeState,
    operation: HostedMetadataMutationOperation,
  ): unknown {
    const storage = storageFor(runtime);
    const db = storage.database;
    switch (operation.kind) {
      case 'project.create': {
        const catalogueId = operation.body.catalogueId;
        if (catalogueId !== undefined && !projectCatalogueIds.has(catalogueId)) {
          throw new HostedRuntimeError('BAD_REQUEST', 'hosted project catalogue selection is invalid');
        }
        admitMetadataCount(db, 'projects', limits.metadataProjectsPerUser, 1);
        const id = nextEntityId(runtime, 'project');
        const now = Date.now();
        createOwnedProjectRoot(storage.roots.projectsRoot, id);
        try {
          const project = insertProject(db, {
            id,
            name: operation.body.title,
            createdAt: now,
            updatedAt: now,
            metadata: {
              kind: operation.body.kind ?? 'prototype',
              ...(catalogueId === undefined ? {} : { catalogueId }),
            },
          });
          return { project };
        } catch (error) {
          removeOwnedProjectRoot(storage.roots.projectsRoot, id);
          throw error;
        }
      }
      case 'project.patch': {
        requireOwnedProject(runtime, operation.projectId);
        const project = updateProject(db, operation.projectId, {
          ...(operation.body.title === undefined ? {} : { name: operation.body.title }),
        });
        return { project };
      }
      case 'project.delete': {
        requireOwnedProject(runtime, operation.projectId);
        const conversations = listConversations(db, operation.projectId);
        deleteProject(db, operation.projectId);
        for (const conversation of conversations) forgetSession(runtime, conversation.id);
        removeOwnedProjectRoot(storage.roots.projectsRoot, operation.projectId);
        return { ok: true };
      }
      case 'conversation.create': {
        requireOwnedProject(runtime, operation.projectId);
        const source = operation.body.seedFromConversationId === undefined
          ? null
          : requireOwnedConversation(
              runtime,
              operation.projectId,
              operation.body.seedFromConversationId,
            );
        if (operation.body.forkAfterMessageId !== undefined && source == null) {
          throw new HostedRuntimeError(
            'CONVERSATION_NOT_FOUND',
            'hosted fork source conversation was not found',
          );
        }
        admitMetadataCount(
          db,
          'conversations',
          limits.metadataConversationsPerUser,
          1,
        );
        if (source != null) {
          admitMetadataCount(db, 'messages', limits.metadataMessagesPerUser);
        }
        let seedMessages = source == null ? [] : listMessages(db, source.id);
        if (operation.body.forkAfterMessageId !== undefined) {
          const index = seedMessages.findIndex(
            (message) => message.id === operation.body.forkAfterMessageId,
          );
          if (index < 0) {
            throw new HostedRuntimeError('MESSAGE_NOT_FOUND', 'hosted fork message was not found');
          }
          seedMessages = seedMessages.slice(0, index + 1);
        }
        admitMetadataCount(
          db,
          'messages',
          limits.metadataMessagesPerUser,
          seedMessages.length,
        );
        const id = nextEntityId(runtime, 'conversation');
        const now = Date.now();
        const conversation = insertConversation(db, {
          id,
          projectId: operation.projectId,
          title: operation.body.title ?? null,
          sessionMode: operation.body.sessionMode ?? source?.sessionMode ?? 'design',
          createdAt: now,
          updatedAt: now,
        });
        for (const message of seedMessages) {
          upsertMessage(db, id, cloneHostedMessage(runtime, message));
        }
        return { conversation };
      }
      case 'conversation.patch': {
        requireOwnedConversation(runtime, operation.projectId, operation.conversationId);
        return {
          conversation: updateConversation(db, operation.conversationId, operation.body),
        };
      }
      case 'conversation.delete':
        requireOwnedConversation(runtime, operation.projectId, operation.conversationId);
        deleteConversation(db, operation.conversationId);
        forgetSession(runtime, operation.conversationId);
        return { ok: true };
      case 'message.upsert': {
        requireOwnedConversation(runtime, operation.projectId, operation.conversationId);
        const exists = assertMessageIdentifierAvailable(
          db,
          operation.conversationId,
          operation.messageId,
        );
        if (operation.body.agentId !== undefined && operation.body.agentId !== 'pi') {
          throw new HostedRuntimeError('BAD_REQUEST', 'hosted agent is outside the fixed catalogue');
        }
        if (operation.body.runId !== undefined) {
          const run = runServiceFor(runtime).get(operation.body.runId);
          if (run == null || run.conversationId !== operation.conversationId) {
            throw new HostedRuntimeError('NOT_FOUND', 'hosted run was not found');
          }
        }
        assertOwnedCommentIds(runtime, operation.conversationId, operation.body.commentIds);
        assertUnavailableContentIds(operation.body.attachmentIds, 'attachment');
        assertUnavailableContentIds(operation.body.producedFileIds, 'produced file');
        admitMetadataCount(
          db,
          'messages',
          limits.metadataMessagesPerUser,
          exists ? 0 : 1,
        );
        const hostedState = {
          ...(operation.body.resumable === undefined
            ? {}
            : { resumable: operation.body.resumable }),
          ...(operation.body.telemetryFinalized === undefined
            ? {}
            : { telemetryFinalized: operation.body.telemetryFinalized }),
        };
        const message = upsertMessage(db, operation.conversationId, {
          id: operation.messageId,
          role: operation.body.role,
          content: operation.body.content,
          agentId: operation.body.agentId,
          events: operation.body.events,
          runId: operation.body.runId,
          runStatus: operation.body.runStatus,
          lastRunEventId: operation.body.lastRunEventId,
          startedAt: operation.body.startedAt,
          endedAt: operation.body.endedAt,
          sessionMode: operation.body.sessionMode,
          attachments: operation.body.attachmentIds,
          commentAttachments: operation.body.commentIds,
          producedFiles: operation.body.producedFileIds,
          ...(Object.keys(hostedState).length === 0
            ? {}
            : { runContext: { hosted: hostedState } }),
        });
        updateProject(db, operation.projectId, {});
        return { message: hostedMessageRow(message) };
      }
      case 'comment.create': {
        requireOwnedConversation(runtime, operation.projectId, operation.conversationId);
        for (const attachment of operation.body.attachments ?? []) {
          if (!ownedRelativeFile(storage.roots.projectsRoot, operation.projectId, attachment.path)) {
            throw new HostedRuntimeError('FILE_NOT_FOUND', 'hosted comment attachment was not found');
          }
        }
        admitMetadataCount(
          db,
          'comments',
          limits.metadataCommentsPerUser,
          previewCommentExists(
            db,
            operation.projectId,
            operation.conversationId,
            operation.body,
          ) ? 0 : 1,
        );
        return {
          comment: upsertPreviewComment(
            db,
            operation.projectId,
            operation.conversationId,
            operation.body,
          ),
        };
      }
      case 'tabs.put': {
        requireOwnedProject(runtime, operation.projectId);
        const current = listTabs(db, operation.projectId);
        const currentCount = hostedTabCount(current);
        const nextCount = (operation.body.tabs?.length ?? 0)
          + (operation.body.browserTabs?.length ?? 0);
        admitMetadataCount(
          db,
          'tabs',
          limits.metadataTabsPerUser,
          nextCount - currentCount,
        );
        return setTabs(db, operation.projectId, {
          tabs: operation.body.tabs ?? [],
          active: operation.body.active ?? null,
          browserTabs: operation.body.browserTabs ?? [],
        });
      }
    }
  }

  function requireOwnedProject(runtime: RuntimeState, projectId: string) {
    const project = getProject(storageFor(runtime).database, projectId);
    if (project == null) {
      throw new HostedRuntimeError('PROJECT_NOT_FOUND', 'hosted project was not found');
    }
    return project;
  }

  function validateJournalMutationScope(
    runtime: RuntimeState,
    scope:
      | { readonly kind: 'run'; readonly runId: string }
      | { readonly kind: 'project'; readonly projectId: string },
  ): void {
    if (scope.kind === 'project') {
      requireOwnedProject(runtime, scope.projectId);
      return;
    }
    validateInternalId(scope.runId, 'run');
    if (runServiceFor(runtime).get(scope.runId) == null) {
      throw new HostedRuntimeError('NOT_FOUND', 'hosted run was not found');
    }
  }

  function validateJournalMutationEvents(
    runtime: RuntimeState,
    scope:
      | { readonly kind: 'run'; readonly runId: string }
      | { readonly kind: 'project'; readonly projectId: string },
    events: readonly HostedDurableEventInput[],
  ): void {
    if (!Array.isArray(events) || events.length === 0) {
      runtimeUnavailable('hosted journal mutation events are invalid');
    }
    for (const event of events) {
      const channel = event?.channel;
      const owned = scope.kind === 'run'
        ? (channel?.kind === 'run' || channel?.kind === 'run-ui')
          && channel.runId === scope.runId
        : channel?.kind === 'project'
          ? channel.projectId === scope.projectId
          : (channel?.kind === 'run' || channel?.kind === 'run-ui')
            && runServiceFor(runtime).get(channel.runId)?.projectId === scope.projectId;
      if (!owned) runtimeUnavailable('hosted journal mutation escaped its authority');
    }
  }

  function requireOwnedConversation(
    runtime: RuntimeState,
    projectId: string,
    conversationId: string,
  ) {
    requireOwnedProject(runtime, projectId);
    const conversation = getConversation(storageFor(runtime).database, conversationId);
    if (conversation == null || conversation.projectId !== projectId) {
      throw new HostedRuntimeError('CONVERSATION_NOT_FOUND', 'hosted conversation was not found');
    }
    return conversation;
  }

  function nextEntityId(
    runtime: RuntimeState,
    kind: 'project' | 'conversation' | 'message',
  ): string {
    const id = createEntityId(kind, runtime.binding.userKey);
    validateInternalId(id, kind);
    return id;
  }

  function cloneHostedMessage(runtime: RuntimeState, message: Record<string, unknown>) {
    return {
      id: nextEntityId(runtime, 'message'),
      role: message.role,
      content: message.content,
      agentId: message.agentId,
      agentName: message.agentName,
      events: message.events,
      attachments: message.attachments,
      commentAttachments: message.commentAttachments,
      producedFiles: message.producedFiles,
      sessionMode: message.sessionMode,
    };
  }

  function forgetSession(runtime: RuntimeState, conversationId: string): void {
    const reference = runtime.sessions.get(conversationId);
    if (reference == null) return;
    runtime.sessions.delete(conversationId);
    runtime.sessionReferenceBytes -= Buffer.byteLength(reference, 'utf8');
  }

  function assertOwnedCommentIds(
    runtime: RuntimeState,
    conversationId: string,
    commentIds: readonly string[] | undefined,
  ): void {
    if (commentIds === undefined || commentIds.length === 0) return;
    const conversation = getConversation(storageFor(runtime).database, conversationId);
    if (conversation == null) {
      throw new HostedRuntimeError('CONVERSATION_NOT_FOUND', 'hosted conversation was not found');
    }
    const owned = new Set(listPreviewComments(
      storageFor(runtime).database,
      conversation.projectId,
      conversationId,
    ).map((comment) => comment.id));
    if (commentIds.some((id) => !owned.has(id))) {
      throw new HostedRuntimeError('NOT_FOUND', 'hosted comment was not found');
    }
  }

  function assertUnavailableContentIds(
    ids: readonly string[] | undefined,
    label: string,
  ): void {
    if (ids !== undefined && ids.length > 0) {
      throw new HostedRuntimeError('FILE_NOT_FOUND', `hosted ${label} was not found`);
    }
  }

  function validateHostedRunIntentOwnership(
    runtime: RuntimeState,
    intent: NormalizedHostedRunIntentV1,
  ): void {
    validateInternalId(intent.projectId, 'project');
    validateInternalId(intent.conversationId, 'conversation');
    validateInternalId(intent.assistantMessageId, 'message');
    if (intent.agentId !== 'pi') {
      throw new HostedRuntimeError('BAD_REQUEST', 'hosted agent is outside the fixed catalogue');
    }
    requireOwnedProject(runtime, intent.projectId);
    requireOwnedConversation(runtime, intent.projectId, intent.conversationId);
    const message = listMessages(
      storageFor(runtime).database,
      intent.conversationId,
    ).find((candidate) => candidate.id === intent.assistantMessageId);
    if (message == null || message.role !== 'assistant') {
      throw new HostedRuntimeError('MESSAGE_NOT_FOUND', 'hosted message was not found');
    }
    for (const id of intent.skillIds) {
      if (!skillCatalogueIds.has(id)) {
        throw new HostedRuntimeError('BAD_REQUEST', 'hosted skill is outside the fixed catalogue');
      }
    }
    if (
      intent.designSystemId !== null
      && !designSystemCatalogueIds.has(intent.designSystemId)
    ) {
      throw new HostedRuntimeError(
        'BAD_REQUEST',
        'hosted design system is outside the fixed catalogue',
      );
    }
    if (
      intent.attachmentIds.length > 0
      || intent.commentAttachmentIds.length > 0
      || intent.contextSelectionIds.length > 0
    ) {
      throw new HostedRuntimeError(
        'BAD_REQUEST',
        'hosted content attachments are unavailable before content activation',
      );
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

type MetadataResource = 'comments' | 'conversations' | 'messages' | 'projects' | 'tabs';

const METADATA_COUNT_SQL: Readonly<Record<Exclude<MetadataResource, 'tabs'>, string>> =
  Object.freeze({
    comments: 'SELECT COUNT(*) AS count FROM preview_comments',
    conversations: 'SELECT COUNT(*) AS count FROM conversations',
    messages: 'SELECT COUNT(*) AS count FROM messages',
    projects: 'SELECT COUNT(*) AS count FROM projects',
  });

function admitMetadataCount(
  db: HostedRuntimeStorage['database'],
  resource: MetadataResource,
  maximum: number,
  change = 0,
): void {
  const row = db.prepare(resource === 'tabs'
    ? `SELECT
         (SELECT COUNT(*) FROM tabs)
         + (SELECT COALESCE(SUM(
             CASE
               WHEN json_valid(state_json)
                AND json_type(state_json, '$.browserTabs') = 'array'
                 THEN json_array_length(state_json, '$.browserTabs')
               ELSE 0
             END
           ), 0) FROM tabs_state) AS count`
    : METADATA_COUNT_SQL[resource]).get() as { count?: unknown } | undefined;
  const count = Number(row?.count);
  if (!Number.isSafeInteger(count) || count < 0) {
    runtimeUnavailable('hosted metadata cardinality is invalid');
  }
  if (count + change > maximum) {
    throw new HostedRuntimeError(
      'HOSTED_QUOTA_EXCEEDED',
      `hosted ${resource} quota is exceeded`,
    );
  }
}

function hostedTabCount(state: ReturnType<typeof listTabs>): number {
  return state.tabs.length
    + ('browserTabs' in state && Array.isArray(state.browserTabs) ? state.browserTabs.length : 0);
}

function previewCommentExists(
  db: HostedRuntimeStorage['database'],
  projectId: string,
  conversationId: string,
  body: Extract<HostedMetadataMutationOperation, { kind: 'comment.create' }>['body'],
): boolean {
  return db.prepare(
    `SELECT 1
       FROM preview_comments
      WHERE project_id = ?
        AND conversation_id = ?
        AND file_path = ?
        AND element_id = ?
        AND slide_key = ?`,
  ).get(
    projectId,
    conversationId,
    body.target.filePath.trim(),
    body.target.elementId.trim(),
    body.target.slideIndex ?? -1,
  ) != null;
}

function hostedMessageRow(message: Record<string, any> | null) {
  if (message == null) return null;
  const hosted = message.runContext?.hosted;
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    ...(message.agentId === undefined ? {} : { agentId: message.agentId }),
    ...(message.agentName === undefined ? {} : { agentName: message.agentName }),
    ...(message.events === undefined ? {} : { events: message.events }),
    ...(message.runId === undefined ? {} : { runId: message.runId }),
    ...(message.runStatus === undefined ? {} : { runStatus: message.runStatus }),
    ...(hosted?.resumable === undefined ? {} : { resumable: hosted.resumable }),
    ...(message.lastRunEventId === undefined
      ? {}
      : { lastRunEventId: message.lastRunEventId }),
    ...(message.startedAt === undefined ? {} : { startedAt: Number(message.startedAt) }),
    ...(message.endedAt === undefined ? {} : { endedAt: Number(message.endedAt) }),
    ...(message.sessionMode === undefined ? {} : { sessionMode: message.sessionMode }),
    ...(message.attachments === undefined ? {} : { attachmentIds: message.attachments }),
    ...(message.commentAttachments === undefined
      ? {}
      : { commentIds: message.commentAttachments }),
    ...(message.producedFiles === undefined
      ? {}
      : { producedFileIds: message.producedFiles }),
    ...(message.createdAt === undefined ? {} : { createdAt: Number(message.createdAt) }),
    ...(hosted?.telemetryFinalized === undefined
      ? {}
      : { telemetryFinalized: hosted.telemetryFinalized }),
  };
}

function assertMessageIdentifierAvailable(
  db: HostedRuntimeStorage['database'],
  conversationId: string,
  messageId: string,
): boolean {
  const existing = db.prepare(
    'SELECT conversation_id AS conversationId FROM messages WHERE id = ?',
  ).get(messageId) as { conversationId?: unknown } | undefined;
  if (existing != null && existing.conversationId !== conversationId) {
    throw new HostedRuntimeError('MESSAGE_NOT_FOUND', 'hosted message was not found');
  }
  return existing != null;
}

function createOwnedProjectRoot(projectsRoot: string, projectId: string): void {
  const root = fs.realpathSync(projectsRoot);
  const target = path.join(root, projectId);
  fs.mkdirSync(target);
  const stat = fs.lstatSync(target);
  const resolved = fs.realpathSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !sameFsPath(path.dirname(resolved), root)) {
    try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* preserve primary failure */ }
    throw new HostedRuntimeError('HOSTED_RUNTIME_UNAVAILABLE', 'hosted project root is invalid');
  }
}

function projectContentError(error: unknown): Error {
  if (error instanceof HostedRuntimeError) return error;
  if (error instanceof ProjectFileContentConflictError) {
    return new HostedRuntimeError('CONFLICT', error.message);
  }
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return new HostedRuntimeError('FILE_NOT_FOUND', 'hosted project content was not found');
  }
  if (code === 'EEXIST') {
    return new HostedRuntimeError('CONFLICT', 'hosted project content already exists');
  }
  if (code === 'EINVAL' || code === 'EISDIR') {
    return new HostedRuntimeError('BAD_REQUEST', 'hosted project content request is invalid');
  }
  return new HostedRuntimeError(
    'HOSTED_RUNTIME_UNAVAILABLE',
    'hosted project content operation failed',
  );
}

function exactOwnedProjectRoot(projectsRoot: string, projectId: string): string {
  const root = fs.realpathSync(projectsRoot);
  const target = path.join(root, projectId);
  const stat = fs.lstatSync(target);
  const resolved = fs.realpathSync(target);
  if (
    !stat.isDirectory()
    || stat.isSymbolicLink()
    || !sameFsPath(path.dirname(resolved), root)
  ) {
    throw new HostedRuntimeError('HOSTED_RUNTIME_UNAVAILABLE', 'hosted project root is invalid');
  }
  return resolved;
}

function removeOwnedProjectRoot(projectsRoot: string, projectId: string): void {
  const root = fs.realpathSync(projectsRoot);
  const target = path.join(root, projectId);
  if (!fs.existsSync(target)) return;
  const stat = fs.lstatSync(target);
  const resolved = fs.realpathSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !sameFsPath(path.dirname(resolved), root)) {
    throw new HostedRuntimeError('HOSTED_RUNTIME_UNAVAILABLE', 'hosted project root is invalid');
  }
  fs.rmSync(resolved, { recursive: true, force: false });
}

function ownedRelativeFile(
  projectsRoot: string,
  projectId: string,
  relativePath: string,
): boolean {
  try {
    const projectRoot = fs.realpathSync(path.join(projectsRoot, projectId));
    let current = projectRoot;
    for (const segment of relativePath.split('/')) {
      current = path.join(current, segment);
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) return false;
    }
    const stat = fs.statSync(current);
    const resolved = fs.realpathSync(current);
    const relative = path.relative(projectRoot, resolved);
    return stat.isFile()
      && relative !== ''
      && !path.isAbsolute(relative)
      && relative !== '..'
      && !relative.startsWith(`..${path.sep}`);
  } catch {
    return false;
  }
}

function sameFsPath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
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

function hydrateSessionReference(value: string, sessionRoot: string): string {
  validateSessionReference(value);
  if (!path.isAbsolute(value)) return value;
  const relative = path.relative(sessionRoot, value);
  if (
    !relative
    || path.isAbsolute(relative)
    || relative === '..'
    || relative.startsWith(`..${path.sep}`)
  ) runtimeUnavailable('hosted session reference is invalid');
  return relative.split(path.sep).join('/');
}

function hydrateSessionReferences(
  runtime: RuntimeState,
  storage: HostedRuntimeStorage,
  limits: HostedRuntimeLimits,
): void {
  const rows = storage.database.prepare(
    `SELECT conversation_id AS conversationId, session_id AS sessionReference
       FROM agent_sessions
      WHERE agent_id = 'pi'
      ORDER BY conversation_id
      LIMIT ?`,
  ).all(limits.sessionReferencesPerUser + 1) as Array<{
    conversationId?: unknown;
    sessionReference?: unknown;
  }>;
  if (rows.length > limits.sessionReferencesPerUser) {
    runtimeUnavailable('hosted session reference quota is invalid');
  }
  for (const row of rows) {
    if (typeof row.conversationId !== 'string' || typeof row.sessionReference !== 'string') {
      runtimeUnavailable('hosted session reference is invalid');
    }
    validateInternalId(row.conversationId, 'conversation');
    const sessionReference = hydrateSessionReference(
      row.sessionReference,
      storage.roots.sessionsRoot,
    );
    runtime.sessionReferenceBytes += Buffer.byteLength(sessionReference, 'utf8');
    if (runtime.sessionReferenceBytes > limits.sessionReferenceBytesPerUser) {
      runtimeUnavailable('hosted session reference quota is invalid');
    }
    runtime.sessions.set(row.conversationId, sessionReference);
  }
}

function hydrateRunReceipts(
  runService: ReturnType<typeof createChatRunService>,
  receipts: readonly HostedRunReceipt[],
): void {
  for (const receipt of receipts) {
    const run = runService.createWithId(receipt.result.runId, {
      assistantMessageId: receipt.result.assistantMessageId,
      clientRequestId: receipt.clientRequestId,
      conversationId: receipt.result.conversationId,
    });
    run.status = receipt.status;
    (run as typeof run & { resumable?: boolean }).resumable = receipt.resumable;
    run.createdAt = receipt.createdAt;
    run.updatedAt = receipt.updatedAt;
  }
}

function readEventJournalSnapshot(
  storage: HostedRuntimeStorage,
): HostedEventJournalSnapshotV1 | undefined {
  const file = path.join(storage.roots.runsRoot, EVENT_JOURNAL_SNAPSHOT);
  const info = fs.lstatSync(file, { throwIfNoEntry: false });
  if (info == null) return undefined;
  const maxBytes = HOSTED_EVENT_LIMITS.maxBytes
    + HOSTED_EVENT_LIMITS.maxEvents * 1_024
    + 64 * 1_024;
  if (
    !info.isFile()
    || info.isSymbolicLink()
    || info.size > maxBytes
    || path.relative(fs.realpathSync(file), file) !== ''
  ) {
    runtimeUnavailable('hosted event journal snapshot is invalid');
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as HostedEventJournalSnapshotV1;
  } catch {
    runtimeUnavailable('hosted event journal snapshot is invalid');
  }
}

function writeEventJournalSnapshot(
  storage: HostedRuntimeStorage,
  snapshot: HostedEventJournalSnapshotV1,
): void {
  fs.writeFileSync(
    path.join(storage.roots.runsRoot, EVENT_JOURNAL_SNAPSHOT),
    `${JSON.stringify(snapshot)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
}

function durabilityError(error: HostedDurabilityError): HostedRuntimeError {
  const cause = error.cause;
  if (cause instanceof HostedSnapshotError) {
    return new HostedRuntimeError(cause.code, 'hosted snapshot publication failed');
  }
  return new HostedRuntimeError(
    'HOSTED_RUNTIME_UNAVAILABLE',
    error.code === 'HOSTED_SNAPSHOT_TIMEOUT'
      ? 'hosted snapshot publication timed out'
      : 'hosted snapshot publication failed',
  );
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
