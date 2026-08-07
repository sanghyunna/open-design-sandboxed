import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http, { type IncomingMessage, type Server } from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Socket } from 'node:net';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import {
  API_ERROR_CODES,
  createApiError,
  HOSTED_CSRF_HEADER,
  HOSTED_PROVIDER_IDS,
  HOSTED_RUN_STATUSES,
  type ApiErrorCode,
  type HostedProviderClearResponse,
  type HostedProviderDescriptor,
  type HostedProviderId,
  type HostedProviderSetResponse,
  type HostedProviderStatusResponse,
  type HostedProviderTestResponse,
  type HostedGenUiSurface,
  type HostedRunFeedbackRequest,
  type HostedSessionResponse,
} from '@open-design/contracts';
import {
  createHostedRuntimeRegistry,
  dispatchHostedRuntimeInternalOperation,
  HostedRuntimeError,
  readHostedRuntimeRegistryCapacity,
  type HostedProviderCredential,
  type HostedRuntimeCapacitySnapshot,
  type HostedRuntimeLease,
  type HostedRuntimeMeasurement,
  type HostedRuntimeRegistry,
} from './hosted-runtime-registry.js';
export type {
  HostedRuntimeCapacitySnapshot,
  HostedRuntimeMeasurement,
} from './hosted-runtime-registry.js';
import { HostedArtifactAdapterError } from './hosted-artifact-adapter.js';
import { HostedContentAdapterError } from './hosted-content-adapter.js';
import { HostedContentQuotaError } from './hosted-content-quota.js';
import { HostedDownloadError } from './hosted-download-stream.js';
import { HostedPreviewScopeError } from './hosted-preview-scope.js';
import { HostedUploadError } from './hosted-upload-adapter.js';
import {
  createHostedCatalogueAdapter,
  HostedCatalogueAdapterError,
  type HostedCatalogueSnapshot,
} from './hosted-catalogue-adapter.js';
import {
  createHostedDesignSystemToolAdapter,
  HOSTED_DESIGN_SYSTEM_READ_ENDPOINT,
  HostedDesignSystemToolAdapterError,
} from './hosted-design-system-tool-adapter.js';
import {
  type HostedDurableEventMilestone,
  type HostedEventChannel,
  type HostedEventLimits,
} from './hosted-event-journal.js';
import {
  createHostedMetadataAdapter,
  HostedMetadataAdapterError,
  type HostedMetadataMutationOperation,
  type HostedMetadataReadOperation,
} from './hosted-metadata-adapter.js';
import {
  HOSTED_LAST_EVENT_ID_MAX_BYTES,
  type HostedSseOpenResult,
} from './hosted-sse-adapter.js';
import {
  createHostedRunAdapter,
  HostedRunAdapterError,
  type HostedRunMutationOperation,
  type HostedRunReadOperation,
  type HostedRunStartOperation,
} from './hosted-run-adapter.js';
import {
  startHostedPiTurn,
  type HostedPiTurnDependencies,
  type HostedPiTurnInput,
  type HostedPiTurnResult,
} from './runtimes/hosted-pi-turn.js';
import { sendApiError, statusForError } from './http/response.js';
import { resolveProjectRoot } from './project-root.js';
import { listSkills } from './skills.js';
import { listDesignSystems } from './design-systems.js';
import {
  hasCanonicalHostedRawPath,
  hasHostedClientOwnershipMetadata,
} from './hosted-request-boundary.js';
import { ProjectCheckpointError } from './project-checkpoints.js';
import { createHostedBodyCapacity } from './hosted-body-capacity.js';
import { PreviewHttpError } from './document-preview.js';
import { registerHostedContentRoutes } from './routes/hosted-content.js';

const CSRF_TTL_MS = 10 * 60_000;
const MAX_CSRF_BINDINGS = 65_536;
const MAX_PROVIDER_SECRET_BYTES = 16 * 1024;
const MAX_PROVIDER_JSON_BYTES = 128 * 1024;
const MAX_HOSTED_JSON_BYTES = 4 * 1024 * 1024;
const HOSTED_JSON_BODY_TIMEOUT_MS = 30_000;
const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024;
const PROVIDER_CONNECT_TIMEOUT_MS = 5_000;
const PROVIDER_CALL_TIMEOUT_MS = 60_000;
const HOSTED_THINKING_CATALOGUE = Object.freeze([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]);

type ProviderEntry = HostedProviderDescriptor & {
  readonly baseUrl: string;
};

export const HOSTED_PROVIDER_CATALOGUE: readonly ProviderEntry[] = Object.freeze([
  Object.freeze({
    id: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    baseUrl: 'https://api.anthropic.com',
  }),
  Object.freeze({
    id: 'vercel-ai-gateway',
    model: 'anthropic/claude-sonnet-4.5',
    baseUrl: 'https://ai-gateway.vercel.sh',
  }),
]);

export interface HostedResolvedIdentity {
  /** Canonical issuer/subject identity produced by the trusted adapter. */
  readonly userKey: string;
  /** Opaque binding for the verified browser cookie or CLI bearer session. */
  readonly sessionKey: string;
  readonly displayName?: string;
}

export interface HostedIdentityMetadata {
  readonly method: string;
  readonly path: string;
  readonly requestId: string;
}

export interface HostedIdentityAdapter {
  resolveIdentity(
    request: Request,
    metadata: HostedIdentityMetadata,
  ): HostedResolvedIdentity | null | Promise<HostedResolvedIdentity | null>;
}

export interface HostedTestComposition {
  readonly resolveIdentity: HostedIdentityAdapter['resolveIdentity'];
  readonly providerBaseUrls?: Partial<Record<HostedProviderId, string>>;
  readonly createEntityId?: (
    kind: 'project' | 'conversation' | 'message',
    userKey: string,
  ) => string;
  readonly createRunId?: (userKey: string) => string;
  readonly startTurn?: (
    input: HostedPiTurnInput,
    dependencies: Pick<HostedPiTurnDependencies, 'designSystemTool'>,
  ) => Promise<HostedPiTurnResult>;
  readonly bodyReadTimeoutMs?: number;
  readonly eventBudgetLimits?: Partial<HostedEventLimits>;
  readonly idleEvictionMs?: number;
  readonly registerRuntimeProbe?: (read: () => HostedRuntimeCapacitySnapshot) => void;
  readonly onRuntimeMeasurement?: (measurement: HostedRuntimeMeasurement) => void;
  readonly shutdownRegistry?: (shutdown: () => Promise<void>) => Promise<void>;
}

export interface StartHostedServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly publicOrigin: string;
  readonly runtimeRoot?: string;
  /** Trusted immutable resource root; never populated from an HTTP request. */
  readonly resourceRoot?: string;
  readonly identityAdapter?: HostedIdentityAdapter;
  /** Test identities and loopback fixtures are structurally absent from production startup. */
  readonly testComposition?: HostedTestComposition;
}

export interface HostedServerHandle {
  readonly url: string;
  readonly server: Server;
  shutdown(): Promise<void>;
}

type HostedRequestState = {
  readonly bindingKey: string;
  readonly identity: HostedResolvedIdentity;
  readonly lease: HostedRuntimeLease;
};

type HostedIdentityRequestState = Omit<HostedRequestState, 'lease'>;

type CsrfState = {
  readonly expiresAt: number;
  readonly token: string;
};

class HostedHttpError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HostedHttpError';
  }
}

export async function startHostedServer(
  options: StartHostedServerOptions,
): Promise<HostedServerHandle> {
  const host = options.host ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '::1' && host !== 'localhost') {
    throw new Error('hosted daemon must bind to loopback behind the public web sidecar');
  }
  const publicOrigin = exactOrigin(options.publicOrigin);
  const testComposition = process.env.NODE_ENV === 'test' ? options.testComposition : undefined;
  if (options.identityAdapter != null && testComposition != null) {
    throw new Error('hosted production and test identity adapters are mutually exclusive');
  }
  const resolveIdentity = options.identityAdapter?.resolveIdentity
    ?? testComposition?.resolveIdentity
    ?? null;
  const providerBaseUrls = providerDestinations(testComposition?.providerBaseUrls);
  const createRunId = testComposition?.createRunId ?? (() => randomUUID());
  const bodyReadTimeoutMs = testComposition?.bodyReadTimeoutMs ?? HOSTED_JSON_BODY_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(bodyReadTimeoutMs)
    || bodyReadTimeoutMs < 1
    || bodyReadTimeoutMs > HOSTED_JSON_BODY_TIMEOUT_MS
  ) throw new Error('hosted body read timeout is invalid');
  const catalogueSnapshot = await loadHostedCatalogue(options.resourceRoot);
  const catalogue = createHostedCatalogueAdapter(catalogueSnapshot);
  const hostedSkills = catalogue.dispatch({ kind: 'skills.list' });
  const hostedDesignSystems = catalogue.dispatch({ kind: 'designSystems.list' });
  if (!('skills' in hostedSkills) || !('designSystems' in hostedDesignSystems)) {
    throw new Error('hosted catalogue initialization failed');
  }
  const projectCatalogueIds = new Set([
    ...hostedSkills.skills.map(({ id }) => id),
    ...hostedDesignSystems.designSystems.map(({ id }) => id),
  ]);
  const skillCatalogueIds = new Set(hostedSkills.skills.map(({ id }) => id));
  const designSystemCatalogueIds = new Set(
    hostedDesignSystems.designSystems.map(({ id }) => id),
  );
  let toolReadUrl: string | null = null;
  let retireGenerationResources = (_binding: {
    readonly generation: number;
    readonly userKey: string;
  }): void => {};
  let contentRoutes: ReturnType<typeof registerHostedContentRoutes> | null = null;
  const registry = createHostedRuntimeRegistry({
    runtimeRoot: path.resolve(options.runtimeRoot ?? '.tmp/hosted/runtime'),
    designSystemCatalogueIds,
    projectCatalogueIds,
    skillCatalogueIds,
    ...(testComposition?.eventBudgetLimits === undefined
      ? {}
      : { eventBudgetLimits: testComposition.eventBudgetLimits }),
    ...(testComposition?.idleEvictionMs === undefined
      ? {}
      : { idleEvictionMs: testComposition.idleEvictionMs }),
    ...(testComposition?.onRuntimeMeasurement === undefined
      ? {}
      : { onMeasurement: testComposition.onRuntimeMeasurement }),
    onGenerationRetired: (binding) => retireGenerationResources(binding),
    ...(testComposition?.createEntityId === undefined
      ? {}
      : { createEntityId: testComposition.createEntityId }),
    startTurn: (input) => {
      if (toolReadUrl == null) {
        throw new HostedRuntimeError(
          'HOSTED_RUNTIME_UNAVAILABLE',
          'hosted design-system tool endpoint is unavailable',
        );
      }
      const dependencies = {
        designSystemTool: {
          readUrl: toolReadUrl,
          mintGrant(binding) {
            const grant = designSystemTool.mintGrant({
              endpoint: HOSTED_DESIGN_SYSTEM_READ_ENDPOINT,
              generation: binding.generation,
              userKey: binding.userKey,
              runId: binding.runId,
              projectId: binding.projectId,
              designSystemId: binding.designSystemId,
            }, { carrierToken: binding.carrierToken });
            return {
              token: grant.token,
              revoke: () => designSystemTool.revoke(grant.token),
            };
          },
        },
      } satisfies Pick<HostedPiTurnDependencies, 'designSystemTool'>;
      return testComposition?.startTurn == null
        ? startHostedPiTurn(input, dependencies)
        : testComposition.startTurn(input, dependencies);
    },
  });
  testComposition?.registerRuntimeProbe?.(() => readHostedRuntimeRegistryCapacity(registry));
  const designSystemTool = createHostedDesignSystemToolAdapter({
    catalogue: hostedDesignSystems.designSystems.map(({ id }) => {
      const files = catalogueSnapshot.designSystemFiles?.[id];
      if (files === undefined) {
        throw new Error('hosted design-system catalogue initialization failed');
      }
      return { id, files };
    }),
    async validateBinding(binding) {
      const lease = registry.acquire({ userKey: binding.userKey });
      if (lease.generation !== binding.generation) {
        lease.release();
        return null;
      }
      try {
        const [project, run] = await Promise.all([
          dispatchHostedRuntimeInternalOperation(registry, lease, {
            kind: 'project:get',
            projectId: binding.projectId,
          }),
          dispatchHostedRuntimeInternalOperation(registry, lease, {
            kind: 'run:get',
            runId: binding.runId,
          }),
        ]);
        if (
          project == null
          || run == null
          || typeof run !== 'object'
          || (run as { projectId?: unknown }).projectId !== binding.projectId
        ) {
          lease.release();
          return null;
        }
        return { release: () => lease.release() };
      } catch (error) {
        lease.release();
        throw error;
      }
    },
  });
  retireGenerationResources = ({ generation, userKey }) => {
    designSystemTool.revokeGeneration({ generation, userKey });
    contentRoutes?.revokeGeneration({ generation, userKey });
  };
  const openEventStream = async (
    state: HostedRequestState,
    channel: HostedEventChannel,
    lastEventId: string | string[] | undefined,
    response: Response,
  ): Promise<HostedSseOpenResult> => {
    const after = parseLastEventId(lastEventId);
    if (after.kind === 'bad-request') return after.result;
    const lease = registry.acquire({ userKey: state.identity.userKey }, 'weak');
    if (
      lease.storageKey !== state.lease.storageKey
      || lease.generation !== state.lease.generation
    ) {
      lease.release();
      return { code: 'HOSTED_RUNTIME_UNAVAILABLE', kind: 'unavailable' };
    }
    setSseHeaders(response);
    let attached: Awaited<ReturnType<typeof dispatchHostedRuntimeInternalOperation>>;
    try {
      attached = await dispatchHostedRuntimeInternalOperation(registry, lease, {
        kind: 'journal:attach',
        after: after.value,
        channel,
        response,
      });
    } catch (error) {
      clearSseHeaders(response);
      lease.release();
      throw error;
    }
    const result = attached as HostedSseOpenResult;
    if (result.kind !== 'attached') {
      lease.release();
      if (result.kind !== 'resync') clearSseHeaders(response);
      return result;
    }
    if (response.destroyed || response.writableEnded) {
      result.close();
      lease.release();
      return result;
    }
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      response.off('close', release);
      response.off('finish', release);
      lease.release();
    };
    response.on('close', release);
    response.on('finish', release);
    try {
      response.flushHeaders();
    } catch (error) {
      result.close();
      release();
      throw error;
    }
    return result;
  };
  const csrf = new Map<string, CsrfState>();
  const bodyCapacity = createHostedBodyCapacity();
  const app = express();
  app.disable('x-powered-by');
  app.set('case sensitive routing', true);
  app.set('strict routing', true);
  app.use((request, response, next) => {
    if (request.method === 'HEAD' || !hasCanonicalHostedRawPath(request)) {
      apiFailure(response, 404, 'HOSTED_ROUTE_NOT_ALLOWED', 'hosted route is not allowed');
      return;
    }
    next();
  });

  app.get('/api/health', noInput, (_request, response) => response.json({ ok: true }));
  app.get('/api/ready', noInput, (_request, response) => response.json({ ready: true }));
  app.get('/api/version', noInput, (_request, response) => response.json({ composition: 'hosted' }));

  const authenticateIdentity: RequestHandler = async (request, response, next) => {
    if (resolveIdentity == null) {
      apiFailure(response, 503, 'HOSTED_AUTH_UNAVAILABLE', 'hosted identity adapter is unavailable');
      return;
    }
    const requestId = randomUUID();
    try {
      const identity = await resolveIdentity(request, {
        method: request.method,
        path: request.path,
        requestId,
      });
      if (identity == null) {
        apiFailure(response, 401, 'HOSTED_AUTH_REQUIRED', 'hosted authentication is required', requestId);
        return;
      }
      validateSessionKey(identity.sessionKey);
      const state: HostedIdentityRequestState = {
        bindingKey: sessionBindingKey(identity),
        identity: Object.freeze({
          userKey: identity.userKey,
          sessionKey: identity.sessionKey,
          ...(identity.displayName === undefined ? {} : { displayName: identity.displayName }),
        }),
      };
      response.locals.hostedIdentity = state;
      next();
    } catch (error) {
      next(error);
    }
  };

  const acquireRuntime: RequestHandler = (_request, response, next) => {
    try {
      const authenticated = identityState(response);
      const lease = registry.acquire({ userKey: authenticated.identity.userKey });
      response.locals.hosted = { ...authenticated, lease } satisfies HostedRequestState;
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        lease.release();
      };
      response.once('finish', release);
      response.once('close', release);
      next();
    } catch (error) {
      next(error);
    }
  };
  const authenticate: RequestHandler = (request, response, next) => {
    void authenticateIdentity(request, response, (error?: unknown) => {
      if (error != null) {
        next(error);
        return;
      }
      acquireRuntime(request, response, next);
    });
  };

  const requireMutationAuthority: RequestHandler = (request, response, next) => {
    if (request.get('origin') !== publicOrigin) {
      apiFailure(response, 403, 'HOSTED_ORIGIN_INVALID', 'hosted request origin is invalid');
      return;
    }
    const state = requestState(response);
    const nonce = csrf.get(state.bindingKey);
    const supplied = request.get(HOSTED_CSRF_HEADER);
    if (
      nonce == null
      || nonce.expiresAt <= Date.now()
      || supplied == null
      || !constantTimeEqual(nonce.token, supplied)
    ) {
      if (nonce != null && nonce.expiresAt <= Date.now()) csrf.delete(state.bindingKey);
      apiFailure(response, 419, 'HOSTED_CSRF_INVALID', 'hosted CSRF token is invalid or expired');
      return;
    }
    next();
  };

  const boundedJson = (maximumBytes: number): RequestHandler => {
    const parse = express.json({ limit: maximumBytes, strict: true });
    return (request, response, next) => {
      const declaredBytes = request.headers['content-length'];
      if (declaredBytes != null && !/^(?:0|[1-9]\d*)$/u.test(declaredBytes)) {
        next(new HostedHttpError('BAD_REQUEST', 'hosted content length is invalid', 400));
        return;
      }
      const bytes = declaredBytes == null ? maximumBytes : Number(declaredBytes);
      if (!Number.isSafeInteger(bytes) || bytes > maximumBytes) {
        next(new HostedRuntimeError('HOSTED_QUOTA_EXCEEDED', 'hosted request body is too large'));
        return;
      }
      const reservation = bodyCapacity.reserve(requestState(response).identity.userKey, bytes);
      let released = false;
      let timedOut = false;
      const release = (): void => {
        if (released) return;
        released = true;
        reservation.release();
        request.off('aborted', release);
        response.off('finish', release);
        response.off('close', release);
      };
      const finishReading = (): void => {
        clearTimeout(timer);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        if (!response.headersSent) {
          apiFailure(response, 408, 'BAD_REQUEST', 'hosted request body timed out');
          response.once('finish', () => request.destroy());
        } else {
          request.destroy();
        }
      }, bodyReadTimeoutMs);
      timer.unref?.();
      request.once('aborted', release);
      response.once('finish', release);
      response.once('close', release);
      parse(request, response, (error) => {
        finishReading();
        if (timedOut) return;
        next(error);
      });
    };
  };
  const json = boundedJson(MAX_PROVIDER_JSON_BYTES);
  const hostedJson = boundedJson(MAX_HOSTED_JSON_BYTES);
  const rejectAuthorityMetadata: RequestHandler = (request, response, next) => {
    if (hasHostedClientOwnershipMetadata(request)) {
      apiFailure(
        response,
        400,
        'HOSTED_OWNER_FIELD_FORBIDDEN',
        'client ownership fields are not accepted',
      );
      return;
    }
    next();
  };
  const rejectAuthorityBody: RequestHandler = (request, response, next) => {
    if (hasHostedClientOwnershipMetadata(request, true)) {
      apiFailure(
        response,
        400,
        'HOSTED_OWNER_FIELD_FORBIDDEN',
        'client ownership fields are not accepted',
      );
      return;
    }
    next();
  };
  const dispatchMetadata = (
    state: HostedRequestState,
    request: unknown,
  ) => createHostedMetadataAdapter({
    read(_authority, operation: HostedMetadataReadOperation) {
      return dispatchHostedRuntimeInternalOperation(registry, state.lease, {
        kind: 'metadata:read',
        operation,
      });
    },
    mutateInLane(_authority, operation: HostedMetadataMutationOperation) {
      return dispatchHostedRuntimeInternalOperation(registry, state.lease, {
        kind: 'metadata:mutate',
        operation,
      });
    },
  }).dispatch({
    userKey: state.identity.userKey,
    generation: state.lease.generation,
  }, request);
  const requireRun = async (
    state: HostedRequestState,
    runId: string,
  ): Promise<Record<string, unknown>> => {
    const result = await dispatchHostedRuntimeInternalOperation(registry, state.lease, {
      kind: 'run:get',
      runId,
    });
    if (result == null || typeof result !== 'object' || Array.isArray(result)) {
      throw new HostedRuntimeError('NOT_FOUND', 'hosted run was not found');
    }
    return result as Record<string, unknown>;
  };
  const runEvents = async (state: HostedRequestState, runId: string): Promise<unknown[]> => {
    const replay = await dispatchHostedRuntimeInternalOperation(registry, state.lease, {
      kind: 'journal:replay',
      channel: { kind: 'run-ui', runId },
    });
    return isEventReplay(replay) ? replay.events.map(({ data }) => data) : [];
  };
  const dispatchRun = (
    state: HostedRequestState,
    request: unknown,
  ) => createHostedRunAdapter({
    async read(_authority, operation: HostedRunReadOperation) {
      switch (operation.kind) {
        case 'runs.list':
          return dispatchHostedRuntimeInternalOperation(registry, state.lease, {
            kind: 'runs:list',
            ...(operation.projectId === undefined ? {} : { projectId: operation.projectId }),
            ...(operation.conversationId === undefined
              ? {}
              : { conversationId: operation.conversationId }),
            ...(operation.status === undefined ? {} : { status: operation.status }),
          });
        case 'run.status':
          return requireRun(state, operation.runId);
        case 'run.agui':
          await requireRun(state, operation.runId);
          return { events: await runEvents(state, operation.runId) };
        case 'run.genui.list': {
          const run = await requireRun(state, operation.runId);
          return {
            runId: operation.runId,
            surfaces: hostedGenUiSurfaces(run, await runEvents(state, operation.runId)),
          };
        }
        case 'project.genui.list': {
          await dispatchMetadata(state, {
            kind: 'project.get',
            projectId: operation.projectId,
          });
          const listed = await dispatchHostedRuntimeInternalOperation(registry, state.lease, {
            kind: 'runs:list',
            projectId: operation.projectId,
          }) as { runs?: unknown };
          const runs = Array.isArray(listed.runs) ? listed.runs : [];
          const surfaces = await Promise.all(runs.map(async (run) => {
            if (run == null || typeof run !== 'object' || Array.isArray(run)) return [];
            const record = run as Record<string, unknown>;
            return typeof record.id === 'string'
              ? hostedGenUiSurfaces(record, await runEvents(state, record.id))
              : [];
          }));
          return {
            projectId: operation.projectId,
            surfaces: surfaces.flat(),
          };
        }
        case 'run.genui.surface': {
          const run = await requireRun(state, operation.runId);
          const surface = hostedGenUiSurfaces(run, await runEvents(state, operation.runId))
            .find(({ surfaceId }) => surfaceId === operation.surfaceId);
          if (surface == null) {
            throw new HostedRuntimeError('NOT_FOUND', 'hosted GenUI surface was not found');
          }
          return surface;
        }
      }
    },
    async mutateInLane(
      _authority,
      operation: HostedRunMutationOperation,
      execute?: () => Promise<unknown>,
    ) {
      if (execute != null) return execute();
      switch (operation.kind) {
        case 'run.cancel': {
          const status = await requireRun(state, operation.runId);
          if (!HOSTED_RUN_STATUSES.slice(2).includes(status.status as never)) {
            registry.cancel({
              userKey: state.identity.userKey,
              generation: state.lease.generation,
              runId: operation.runId,
            }, 'client request');
            await dispatchHostedRuntimeInternalOperation(registry, state.lease, {
              kind: 'run:wait',
              runId: operation.runId,
            });
          }
          return { ok: true };
        }
        case 'run.feedback': {
          const status = await requireRun(state, operation.runId);
          assertRunReferences(status, operation.body);
          return dispatchHostedRuntimeInternalOperation(registry, state.lease, {
            kind: 'run:mutate',
            scope: { kind: 'run', runId: operation.runId },
            execute: () => ({ status: 'skipped_no_sink' }),
          });
        }
        case 'run.genui.respond': {
          const mutation = await dispatchHostedRuntimeInternalOperation(registry, state.lease, {
            kind: 'journal:mutate',
            scope: { kind: 'run', runId: operation.runId },
            execute: async () => {
              const run = await requireRun(state, operation.runId);
              const surfaces = hostedGenUiSurfaces(
                run,
                await runEvents(state, operation.runId),
              );
              const current = surfaces.find(({ surfaceId, status }) => (
                surfaceId === operation.surfaceId && status === 'pending'
              ));
              if (current == null) {
                throw new HostedRuntimeError('NOT_FOUND', 'hosted GenUI surface was not found');
              }
              const at = Date.now();
              const next = {
                ...current,
                value: operation.body.value,
                status: 'resolved',
                respondedBy: 'user',
                respondedAt: at,
              } as const;
              return {
                events: [{
                  channel: { kind: 'run-ui' as const, runId: operation.runId },
                  event: 'genui-responded',
                  data: { kind: 'ui.surface_responded', runId: operation.runId, ts: at,
                    surfaceId: operation.surfaceId, value: operation.body.value,
                    respondedBy: 'user' },
                  milestone: 'status-transition' as const,
                }],
                value: { surface: next },
              };
            },
          }) as { surface: HostedGenUiSurface };
          return { ok: true, surface: mutation.surface };
        }
        case 'project.genui.revoke': {
          const mutation = await dispatchHostedRuntimeInternalOperation(registry, state.lease, {
            kind: 'journal:mutate',
            scope: { kind: 'project', projectId: operation.projectId },
            execute: async () => {
              const listed = await dispatchHostedRuntimeInternalOperation(registry, state.lease, {
                kind: 'runs:list',
                projectId: operation.projectId,
              }) as { runs?: unknown };
              const runs = Array.isArray(listed.runs) ? listed.runs : [];
              const candidates = await Promise.all(runs.map(async (run) => {
                if (run == null || typeof run !== 'object' || Array.isArray(run)) return [];
                const record = run as Record<string, unknown>;
                if (typeof record.id !== 'string') return [];
                return hostedGenUiSurfaces(record, await runEvents(state, record.id))
                  .filter(({ surfaceId, status }) => (
                    surfaceId === operation.surfaceId && status === 'pending'
                  ))
                  .map(() => record.id as string);
              }));
              const matches = candidates.flat();
              if (matches.length === 0) {
                throw new HostedRuntimeError('NOT_FOUND', 'hosted GenUI surface was not found');
              }
              const at = Date.now();
              return {
                events: matches.map((runId) => ({
                  channel: { kind: 'run-ui' as const, runId },
                  event: 'genui-invalidated',
                  data: { kind: 'ui.surface_invalidated', runId, ts: at,
                    surfaceId: operation.surfaceId },
                  milestone: 'status-transition' as const,
                })),
                value: { invalidated: matches.length },
              };
            },
          }) as { invalidated: number };
          return { ok: true, invalidated: mutation.invalidated };
        }
        case 'run.create':
        case 'chat.create':
          throw new HostedRuntimeError('INTERNAL_ERROR', 'hosted run dispatch is invalid');
      }
    },
    async startChat(_authority, operation: HostedRunStartOperation) {
      await dispatchMetadata(state, {
        kind: 'project.get',
        projectId: operation.intent.projectId,
      });
      const messages = await dispatchMetadata(state, {
        kind: 'messages.list',
        projectId: operation.intent.projectId,
        conversationId: operation.intent.conversationId,
      });
      if (
        !('messages' in messages)
        || !messages.messages.some((message) => (
          message.id === operation.intent.assistantMessageId
          && message.role === 'assistant'
        ))
      ) {
        throw new HostedRuntimeError('MESSAGE_NOT_FOUND', 'hosted message was not found');
      }
      const credential = registry.credentialStatus(state.lease);
      if (!credential.configured || credential.provider == null) {
        throw new HostedRuntimeError(
          'HOSTED_PROVIDER_MISSING',
          'hosted provider credential is not configured',
        );
      }
      const fixedModel = providerEntry(credential.provider).model;
      if (operation.intent.model !== null && operation.intent.model !== fixedModel) {
        throw new HostedRuntimeError('BAD_REQUEST', 'hosted model is outside the fixed catalogue');
      }
      if (
        operation.intent.reasoning !== null
        && !HOSTED_THINKING_CATALOGUE.includes(operation.intent.reasoning)
      ) {
        throw new HostedRuntimeError(
          'BAD_REQUEST',
          'hosted reasoning level is outside the fixed catalogue',
        );
      }
      const runId = createRunId(state.identity.userKey);
      return dispatchHostedRuntimeInternalOperation(registry, state.lease, {
        kind: 'run:start',
        runId,
        routeKind: operation.kind === 'chat.create' ? 'chat' : 'runs',
        intent: operation.intent,
        model: fixedModel,
        modelCatalogue: [fixedModel],
        thinkingCatalogue: HOSTED_THINKING_CATALOGUE,
        mapEvent(channel, payload) {
          const events = hostedRunEvents(channel, payload, {
            agentId: operation.intent.agentId,
            model: fixedModel,
            projectId: operation.intent.projectId,
            reasoning: operation.intent.reasoning,
            runId,
          });
          return [
            ...events.publicEvents.map((event) => ({
              channel: { kind: 'run' as const, runId },
              ...event,
            })),
            ...(events.internalEvent == null
              ? []
              : [{
                  channel: { kind: 'run-ui' as const, runId },
                  ...events.internalEvent,
                }]),
          ];
        },
      });
    },
  }).dispatch({
    userKey: state.identity.userKey,
    generation: state.lease.generation,
  }, request);

  app.get('/api/hosted/session', authenticate, noInput, (_request, response) => {
    removeExpiredCsrf(csrf);
    const state = requestState(response);
    if (!csrf.has(state.bindingKey) && csrf.size >= MAX_CSRF_BINDINGS) {
      throw new HostedRuntimeError(
        'HOSTED_CAPACITY_EXHAUSTED',
        'hosted session capacity is exhausted',
      );
    }
    const nonce: CsrfState = {
      expiresAt: Date.now() + CSRF_TTL_MS,
      token: randomBytes(32).toString('base64url'),
    };
    csrf.set(state.bindingKey, nonce);
    const body: HostedSessionResponse = {
      publicOrigin,
      csrfToken: nonce.token,
      csrfExpiresAt: nonce.expiresAt,
      providers: HOSTED_PROVIDER_CATALOGUE.map(({ id, model }) => ({ id, model })),
    };
    response.set('Cache-Control', 'no-store').json(body);
  });

  app.get('/api/hosted/provider', authenticate, noInput, (_request, response) => {
    const body: HostedProviderStatusResponse = registry.credentialStatus(requestState(response).lease);
    response.set('Cache-Control', 'no-store').json(body);
  });

  app.put(
    '/api/hosted/provider',
    authenticate,
    requireMutationAuthority,
    json,
    async (request, response) => {
      const body = closedObject(request.body, ['provider', 'key']);
      const provider = providerId(body.provider);
      const key = providerSecret(body.key);
      await registry.replaceCredential(requestState(response).lease, { provider, key });
      const result: HostedProviderSetResponse = { result: 'set', provider, configured: true };
      response.set('Cache-Control', 'no-store').json(result);
    },
  );

  app.post(
    '/api/hosted/provider/test',
    authenticate,
    requireMutationAuthority,
    json,
    async (request, response) => {
      const body = closedObject(request.body, ['provider']);
      const provider = providerId(body.provider);
      const lease = requestState(response).lease;
      const current = registry.credentialStatus(lease);
      if (!current.configured || current.provider == null) {
        throw new HostedHttpError(
          'HOSTED_PROVIDER_MISSING',
          'hosted provider credential is not configured',
          409,
        );
      }
      if (current.provider !== provider) {
        throw new HostedHttpError(
          'HOSTED_PROVIDER_INVALID',
          'hosted provider does not match the configured credential',
          400,
        );
      }
      const entry = providerEntry(provider);
      await registry.dispatch(lease, {
        runId: `provider-test-${randomUUID()}`,
        conversationId: 'provider-test',
        execute: async ({ credential, signal }) => {
          if (credential == null || credential.provider !== provider) {
            throw new HostedHttpError(
              'HOSTED_PROVIDER_MISSING',
              'hosted provider credential is not configured',
              409,
            );
          }
          await testProvider(entry, credential, providerBaseUrls[provider], signal);
          return { value: undefined };
        },
      });
      const result: HostedProviderTestResponse = {
        result: 'passed',
        provider,
        model: entry.model,
      };
      response.set('Cache-Control', 'no-store').json(result);
    },
  );

  app.delete(
    '/api/hosted/provider',
    authenticate,
    requireMutationAuthority,
    noInput,
    async (_request, response) => {
      await registry.replaceCredential(requestState(response).lease, null);
      const result: HostedProviderClearResponse = {
        result: 'cleared',
        provider: null,
        configured: false,
      };
      response.set('Cache-Control', 'no-store').json(result);
    },
  );

  app.get(
    '/api/projects',
    authenticate,
    rejectAuthorityMetadata,
    noInput,
    async (_request, response) => {
      response.json(await dispatchMetadata(requestState(response), { kind: 'projects.list' }));
    },
  );
  app.post(
    '/api/projects',
    authenticate,
    rejectAuthorityMetadata,
    requireMutationAuthority,
    hostedJson,
    rejectAuthorityBody,
    async (request, response) => {
      const result = await dispatchMetadata(requestState(response), {
        kind: 'project.create',
        body: request.body,
      });
      response.status(201).json(result);
    },
  );
  app.get(
    '/api/projects/:id',
    authenticate,
    rejectAuthorityMetadata,
    noInput,
    async (request, response) => {
      response.json(await dispatchMetadata(requestState(response), {
        kind: 'project.get',
        projectId: request.params.id,
      }));
    },
  );
  app.patch(
    '/api/projects/:id',
    authenticate,
    rejectAuthorityMetadata,
    requireMutationAuthority,
    hostedJson,
    rejectAuthorityBody,
    async (request, response) => {
      response.json(await dispatchMetadata(requestState(response), {
        kind: 'project.patch',
        projectId: request.params.id,
        body: request.body,
      }));
    },
  );
  app.delete(
    '/api/projects/:id',
    authenticate,
    rejectAuthorityMetadata,
    requireMutationAuthority,
    noInput,
    async (request, response) => {
      response.json(await dispatchMetadata(requestState(response), {
        kind: 'project.delete',
        projectId: request.params.id,
      }));
    },
  );
  app.get(
    '/api/projects/:id/conversations',
    authenticate,
    rejectAuthorityMetadata,
    noInput,
    async (request, response) => {
      response.json(await dispatchMetadata(requestState(response), {
        kind: 'conversations.list',
        projectId: request.params.id,
      }));
    },
  );
  app.post(
    '/api/projects/:id/conversations',
    authenticate,
    rejectAuthorityMetadata,
    requireMutationAuthority,
    hostedJson,
    rejectAuthorityBody,
    async (request, response) => {
      const state = requestState(response);
      const projectId = routeParam(request, 'id');
      const result = await dispatchMetadata(state, {
        kind: 'conversation.create',
        projectId,
        body: request.body,
      });
      if ('conversation' in result) {
        const channel = { kind: 'project' as const, projectId };
        try {
          await dispatchHostedRuntimeInternalOperation(registry, state.lease, {
            kind: 'journal:publish',
            channel,
            event: 'conversation-created',
            data: {
              type: 'conversation-created',
              projectId,
              conversationId: result.conversation.id,
              title: result.conversation.title,
              createdAt: result.conversation.createdAt,
            },
          });
        } catch {
          await dispatchHostedRuntimeInternalOperation(registry, state.lease, {
            kind: 'journal:invalidate',
            channel,
          }).catch(() => {});
        }
      }
      response.status(201).json(result);
    },
  );
  app.patch(
    '/api/projects/:id/conversations/:cid',
    authenticate,
    rejectAuthorityMetadata,
    requireMutationAuthority,
    hostedJson,
    rejectAuthorityBody,
    async (request, response) => {
      response.json(await dispatchMetadata(requestState(response), {
        kind: 'conversation.patch',
        projectId: request.params.id,
        conversationId: request.params.cid,
        body: request.body,
      }));
    },
  );
  app.delete(
    '/api/projects/:id/conversations/:cid',
    authenticate,
    rejectAuthorityMetadata,
    requireMutationAuthority,
    noInput,
    async (request, response) => {
      response.json(await dispatchMetadata(requestState(response), {
        kind: 'conversation.delete',
        projectId: request.params.id,
        conversationId: request.params.cid,
      }));
    },
  );
  app.get(
    '/api/projects/:id/conversations/:cid/messages',
    authenticate,
    rejectAuthorityMetadata,
    noInput,
    async (request, response) => {
      response.json(await dispatchMetadata(requestState(response), {
        kind: 'messages.list',
        projectId: request.params.id,
        conversationId: request.params.cid,
      }));
    },
  );
  app.put(
    '/api/projects/:id/conversations/:cid/messages/:mid',
    authenticate,
    rejectAuthorityMetadata,
    requireMutationAuthority,
    hostedJson,
    rejectAuthorityBody,
    async (request, response) => {
      response.json(await dispatchMetadata(requestState(response), {
        kind: 'message.upsert',
        projectId: request.params.id,
        conversationId: request.params.cid,
        messageId: request.params.mid,
        body: request.body,
      }));
    },
  );
  app.get(
    '/api/projects/:id/conversations/:cid/comments',
    authenticate,
    rejectAuthorityMetadata,
    noInput,
    async (request, response) => {
      response.json(await dispatchMetadata(requestState(response), {
        kind: 'comments.list',
        projectId: request.params.id,
        conversationId: request.params.cid,
      }));
    },
  );
  app.post(
    '/api/projects/:id/conversations/:cid/comments',
    authenticate,
    rejectAuthorityMetadata,
    requireMutationAuthority,
    hostedJson,
    rejectAuthorityBody,
    async (request, response) => {
      response.status(201).json(await dispatchMetadata(requestState(response), {
        kind: 'comment.create',
        projectId: request.params.id,
        conversationId: request.params.cid,
        body: request.body,
      }));
    },
  );
  app.get(
    '/api/projects/:id/tabs',
    authenticate,
    rejectAuthorityMetadata,
    noInput,
    async (request, response) => {
      response.json(await dispatchMetadata(requestState(response), {
        kind: 'tabs.get',
        projectId: request.params.id,
      }));
    },
  );
  app.put(
    '/api/projects/:id/tabs',
    authenticate,
    rejectAuthorityMetadata,
    requireMutationAuthority,
    hostedJson,
    rejectAuthorityBody,
    async (request, response) => {
      response.json(await dispatchMetadata(requestState(response), {
        kind: 'tabs.put',
        projectId: request.params.id,
        body: request.body,
      }));
    },
  );
  app.get(
    '/api/projects/:id/checkpoints',
    authenticate,
    rejectAuthorityMetadata,
    exactQuery(['conversationId']),
    async (request, response) => {
      response.json(await dispatchMetadata(requestState(response), {
        kind: 'checkpoints.list',
        projectId: request.params.id,
        ...(Object.hasOwn(request.query, 'conversationId')
          ? { conversationId: request.query.conversationId }
          : {}),
      }));
    },
  );
  app.get(
    '/api/projects/:id/checkpoints/:checkpointId',
    authenticate,
    rejectAuthorityMetadata,
    noInput,
    async (request, response) => {
      response.json(await dispatchMetadata(requestState(response), {
        kind: 'checkpoint.get',
        projectId: request.params.id,
        checkpointId: request.params.checkpointId,
      }));
    },
  );
  app.get(
    '/api/projects/:id/checkpoints/:checkpointId/diff',
    authenticate,
    rejectAuthorityMetadata,
    exactQuery(['base']),
    async (request, response) => {
      response.json(await dispatchMetadata(requestState(response), {
        kind: 'checkpoint.diff',
        projectId: request.params.id,
        checkpointId: request.params.checkpointId,
        ...(Object.hasOwn(request.query, 'base') ? { base: request.query.base } : {}),
      }));
    },
  );

  contentRoutes = registerHostedContentRoutes(app, {
    authenticate,
    bodyCapacity,
    exactQuery,
    hostedJson,
    noInput,
    registry,
    rejectAuthorityBody,
    rejectAuthorityMetadata,
    requireMutationAuthority,
    secureCookies: publicOrigin.startsWith('https:'),
  });
  app.get(
    '/api/projects/:id/events',
    authenticate,
    rejectAuthorityMetadata,
    noInput,
    async (request, response) => {
      const state = requestState(response);
      const projectId = routeParam(request, 'id');
      await dispatchMetadata(state, {
        kind: 'project.get',
        projectId,
      });
      const lastEventId = request.headers['last-event-id'];
      const result = await openEventStream(
        state,
        { kind: 'project', projectId },
        lastEventId,
        response,
      );
      state.lease.release();
      handleSseOpenResult(response, result);
    },
  );

  app.get(
    '/api/runs',
    authenticate,
    rejectAuthorityMetadata,
    exactQuery(['projectId', 'conversationId', 'status']),
    async (request, response) => {
      response.json(await dispatchRun(requestState(response), {
        kind: 'runs.list',
        ...(Object.hasOwn(request.query, 'projectId')
          ? { projectId: request.query.projectId }
          : {}),
        ...(Object.hasOwn(request.query, 'conversationId')
          ? { conversationId: request.query.conversationId }
          : {}),
        ...(Object.hasOwn(request.query, 'status')
          ? { status: request.query.status }
          : {}),
      }));
    },
  );
  app.post(
    '/api/runs',
    authenticate,
    rejectAuthorityMetadata,
    requireMutationAuthority,
    hostedJson,
    rejectAuthorityBody,
    async (request, response) => {
      const result = await dispatchRun(requestState(response), {
        kind: 'run.create',
        body: request.body,
      });
      response.status(202).json(result);
    },
  );
  app.post(
    '/api/chat',
    authenticate,
    rejectAuthorityMetadata,
    requireMutationAuthority,
    hostedJson,
    rejectAuthorityBody,
    async (request, response) => {
      const state = requestState(response);
      const result = await dispatchRun(state, {
        kind: 'chat.create',
        body: request.body,
      });
      if (
        result == null
        || typeof result !== 'object'
        || Array.isArray(result)
        || typeof (result as { runId?: unknown }).runId !== 'string'
      ) throw new HostedRuntimeError('INTERNAL_ERROR', 'hosted chat admission failed');
      const runId = (result as { runId: string }).runId;
      const opened = await openEventStream(
        state,
        { kind: 'run', runId },
        undefined,
        response,
      );
      state.lease.release();
      handleSseOpenResult(response, opened);
    },
  );
  app.get(
    '/api/runs/:id',
    authenticate,
    rejectAuthorityMetadata,
    noInput,
    async (request, response) => {
      response.json(await dispatchRun(requestState(response), {
        kind: 'run.status',
        runId: routeParam(request, 'id'),
      }));
    },
  );
  app.get(
    '/api/runs/:id/events',
    authenticate,
    rejectAuthorityMetadata,
    noInput,
    async (request, response) => {
      const state = requestState(response);
      const runId = routeParam(request, 'id');
      await requireRun(state, runId);
      const lastEventId = request.headers['last-event-id'];
      const result = await openEventStream(
        state,
        { kind: 'run', runId },
        lastEventId,
        response,
      );
      state.lease.release();
      handleSseOpenResult(response, result);
    },
  );
  app.post(
    '/api/runs/:id/cancel',
    authenticate,
    rejectAuthorityMetadata,
    requireMutationAuthority,
    noInput,
    async (request, response) => {
      response.json(await dispatchRun(requestState(response), {
        kind: 'run.cancel',
        runId: routeParam(request, 'id'),
      }));
    },
  );
  app.post(
    '/api/runs/:id/feedback',
    authenticate,
    rejectAuthorityMetadata,
    requireMutationAuthority,
    hostedJson,
    rejectAuthorityBody,
    async (request, response) => {
      response.json(await dispatchRun(requestState(response), {
        kind: 'run.feedback',
        runId: routeParam(request, 'id'),
        body: request.body,
      }));
    },
  );
  app.get(
    '/api/runs/:id/agui',
    authenticate,
    rejectAuthorityMetadata,
    noInput,
    async (request, response) => {
      response.json(await dispatchRun(requestState(response), {
        kind: 'run.agui',
        runId: routeParam(request, 'id'),
      }));
    },
  );
  app.get(
    '/api/runs/:id/genui',
    authenticate,
    rejectAuthorityMetadata,
    noInput,
    async (request, response) => {
      response.json(await dispatchRun(requestState(response), {
        kind: 'run.genui.list',
        runId: routeParam(request, 'id'),
      }));
    },
  );
  app.get(
    '/api/projects/:projectId/genui',
    authenticate,
    rejectAuthorityMetadata,
    noInput,
    async (request, response) => {
      response.json(await dispatchRun(requestState(response), {
        kind: 'project.genui.list',
        projectId: routeParam(request, 'projectId'),
      }));
    },
  );
  app.get(
    '/api/runs/:runId/genui/:surfaceId',
    authenticate,
    rejectAuthorityMetadata,
    noInput,
    async (request, response) => {
      response.json(await dispatchRun(requestState(response), {
        kind: 'run.genui.surface',
        runId: routeParam(request, 'runId'),
        surfaceId: routeParam(request, 'surfaceId'),
      }));
    },
  );
  app.post(
    '/api/runs/:runId/genui/:surfaceId/respond',
    authenticate,
    rejectAuthorityMetadata,
    requireMutationAuthority,
    hostedJson,
    async (request, response) => {
      response.json(await dispatchRun(requestState(response), {
        kind: 'run.genui.respond',
        runId: routeParam(request, 'runId'),
        surfaceId: routeParam(request, 'surfaceId'),
        body: request.body,
      }));
    },
  );
  app.post(
    '/api/projects/:projectId/genui/:surfaceId/revoke',
    authenticate,
    rejectAuthorityMetadata,
    requireMutationAuthority,
    noInput,
    async (request, response) => {
      response.json(await dispatchRun(requestState(response), {
        kind: 'project.genui.revoke',
        projectId: routeParam(request, 'projectId'),
        surfaceId: routeParam(request, 'surfaceId'),
      }));
    },
  );

  app.get('/api/agents/catalog', authenticateIdentity, rejectAuthorityMetadata, noInput, (_request, response) => {
    response.json(catalogue.dispatch({ kind: 'agents.list' }));
  });
  app.get('/api/skills', authenticateIdentity, rejectAuthorityMetadata, noInput, (_request, response) => {
    response.json(catalogue.dispatch({ kind: 'skills.list' }));
  });
  app.get('/api/skills/:id', authenticateIdentity, rejectAuthorityMetadata, noInput, (request, response) => {
    response.json(catalogue.dispatch({ kind: 'skill.get', id: request.params.id }));
  });
  app.get('/api/skills/:id/files', authenticateIdentity, rejectAuthorityMetadata, noInput, (request, response) => {
    response.json(catalogue.dispatch({ kind: 'skill.files', id: request.params.id }));
  });
  app.get('/api/design-systems', authenticateIdentity, rejectAuthorityMetadata, noInput, (_request, response) => {
    response.json(catalogue.dispatch({ kind: 'designSystems.list' }));
  });
  app.get('/api/design-systems/:id', authenticateIdentity, rejectAuthorityMetadata, noInput, (request, response) => {
    response.json(catalogue.dispatch({ kind: 'designSystem.get', id: request.params.id }));
  });

  const toolJson = express.json({ limit: 8 * 1024, strict: true });
  app.post('/api/tools/design-systems/read', async (request, response) => {
    const authorization = request.get('authorization');
    const token = authorization?.match(/^Bearer ([^\s]+)$/u)?.[1] ?? null;
    const carrierToken = request.get('x-open-design-tool-token') ?? null;
    if (token == null || carrierToken == null || carrierToken.length === 0) {
      apiFailure(response, 403, 'TOOL_TOKEN_MISSING', 'hosted tool token is required');
      return;
    }
    response.json(await designSystemTool.read({
      auth: {
        token,
        carrierToken,
        cookiePresent: request.headers.cookie != null,
        csrfPresent: request.get(HOSTED_CSRF_HEADER) != null,
        origin: request.get('origin') ?? null,
      },
      readBody: () => new Promise((resolve, reject) => {
        toolJson(request, response, (error) => {
          if (error != null) reject(error);
          else resolve(request.body);
        });
      }),
    }));
  });

  app.use((_request, response) => {
    apiFailure(response, 404, 'HOSTED_ROUTE_NOT_ALLOWED', 'hosted route is not allowed');
  });
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (response.headersSent) return;
    if (error instanceof HostedHttpError) {
      apiFailure(response, error.status, error.code, error.message);
      return;
    }
    if (
      error instanceof HostedArtifactAdapterError
      || error instanceof HostedContentAdapterError
      || error instanceof HostedContentQuotaError
      || error instanceof HostedDownloadError
      || error instanceof HostedPreviewScopeError
      || error instanceof HostedUploadError
    ) {
      const apiError = createApiError(error.code, error.message);
      sendApiError(response, statusForError(apiError), apiError);
      return;
    }
    if (error instanceof PreviewHttpError) {
      apiFailure(
        response,
        error.statusCode,
        error.statusCode === 413 ? 'HOSTED_QUOTA_EXCEEDED' : 'UNSUPPORTED_MEDIA_TYPE',
        error.message,
      );
      return;
    }
    if (error instanceof multer.MulterError) {
      const tooLarge = [
        'LIMIT_FILE_COUNT',
        'LIMIT_FILE_SIZE',
        'LIMIT_FIELD_VALUE',
        'LIMIT_PART_COUNT',
      ].includes(error.code);
      apiFailure(
        response,
        tooLarge ? 413 : 400,
        tooLarge ? 'HOSTED_QUOTA_EXCEEDED' : 'BAD_REQUEST',
        tooLarge ? 'hosted upload exceeds its limits' : 'hosted multipart body is invalid',
      );
      return;
    }
    if (error instanceof HostedMetadataAdapterError) {
      apiFailure(
        response,
        error.code === 'BAD_REQUEST' ? 400 : 500,
        error.code,
        error.message,
      );
      return;
    }
    if (error instanceof HostedRunAdapterError) {
      apiFailure(
        response,
        error.code === 'BAD_REQUEST' ? 400 : 500,
        error.code,
        error.message,
      );
      return;
    }
    if (error instanceof HostedCatalogueAdapterError) {
      const status = error.code === 'BAD_REQUEST' ? 400 : error.code === 'NOT_FOUND' ? 404 : 500;
      apiFailure(response, status, error.code, error.message);
      return;
    }
    if (error instanceof HostedDesignSystemToolAdapterError) {
      const status = error.code === 'BAD_REQUEST'
        ? 400
        : error.code === 'NOT_FOUND'
          ? 404
          : error.code === 'HOSTED_CAPACITY_EXHAUSTED'
            ? 503
          : error.code === 'INTERNAL_ERROR'
            ? 500
            : 403;
      apiFailure(response, status, error.code, error.message);
      return;
    }
    if (error instanceof ProjectCheckpointError) {
      const code = API_ERROR_CODES.includes(error.code as ApiErrorCode)
        ? error.code as ApiErrorCode
        : 'INTERNAL_ERROR';
      apiFailure(response, code === 'INTERNAL_ERROR' ? 500 : error.status, code, error.message);
      return;
    }
    if (error instanceof HostedRuntimeError) {
      const apiError = createApiError(error.code, error.message);
      sendApiError(response, statusForError(apiError), apiError);
      return;
    }
    if (isJsonBodyError(error)) {
      const tooLarge = error.type === 'entity.too.large';
      apiFailure(
        response,
        tooLarge ? 413 : 400,
        tooLarge ? 'HOSTED_QUOTA_EXCEEDED' : 'BAD_REQUEST',
        tooLarge ? 'hosted request body is too large' : 'hosted request body is invalid',
      );
      return;
    }
    apiFailure(response, 500, 'INTERNAL_ERROR', 'hosted request failed');
  });

  const server = await listen(app, options.port ?? 7456, host);
  const address = server.address();
  if (address == null || typeof address === 'string') {
    await registry.shutdown();
    throw new Error('hosted server did not bind a TCP address');
  }
  const url = `http://${host === 'localhost' ? '127.0.0.1' : host}:${address.port}`;
  toolReadUrl = `${url}${HOSTED_DESIGN_SYSTEM_READ_ENDPOINT}`;
  let shutdownPromise: Promise<void> | null = null;
  return {
    server,
    url,
    shutdown(): Promise<void> {
      shutdownPromise ??= (async () => {
        csrf.clear();
        designSystemTool.dispose();
        contentRoutes?.dispose();
        const results = await Promise.allSettled([
          testComposition?.shutdownRegistry?.(() => registry.shutdown()) ?? registry.shutdown(),
          closeServer(server),
        ]);
        const errors = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
        if (errors.length > 0) {
          throw errors.length === 1 ? errors[0] : new AggregateError(errors, 'hosted shutdown failed');
        }
      })();
      return shutdownPromise;
    },
  };
}

const noInput: RequestHandler = (request, response, next) => {
  const contentLength = request.headers['content-length'];
  if (
    request.url.includes('?')
    || (contentLength != null && contentLength !== '0')
    || request.headers['transfer-encoding'] != null
  ) {
    apiFailure(response, 400, 'BAD_REQUEST', 'hosted route does not accept input');
    return;
  }
  next();
};

function exactQuery(allowed: readonly string[]): RequestHandler {
  const keys = new Set(allowed);
  return (request, response, next) => {
    if (Object.keys(request.query).some((key) => !keys.has(key))) {
      apiFailure(response, 400, 'BAD_REQUEST', 'hosted query contains unsupported fields');
      return;
    }
    if (
      request.headers['content-length'] != null
      || request.headers['transfer-encoding'] != null
    ) {
      apiFailure(response, 400, 'BAD_REQUEST', 'hosted route does not accept a body');
      return;
    }
    next();
  };
}

function parseLastEventId(value: string | string[] | undefined):
  | { readonly kind: 'ok'; readonly value: string | null }
  | { readonly kind: 'bad-request'; readonly result: HostedSseOpenResult } {
  if (value === undefined) return { kind: 'ok', value: null };
  if (
    typeof value !== 'string'
    || value.length === 0
    || Buffer.byteLength(value, 'utf8') > HOSTED_LAST_EVENT_ID_MAX_BYTES
    || !/^[A-Za-z0-9._-]+$/u.test(value)
  ) {
    return {
      kind: 'bad-request',
      result: { code: 'BAD_REQUEST', kind: 'bad-request', message: 'Last-Event-ID is invalid' },
    };
  }
  return { kind: 'ok', value };
}

function setSseHeaders(response: Response): void {
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.setHeader('X-Accel-Buffering', 'no');
}

function clearSseHeaders(response: Response): void {
  for (const name of ['Content-Type', 'Cache-Control', 'Connection', 'X-Accel-Buffering']) {
    response.removeHeader(name);
  }
}

function isEventReplay(input: unknown): input is {
  readonly kind: 'events';
  readonly events: ReadonlyArray<{ readonly data: unknown }>;
} {
  return input != null
    && typeof input === 'object'
    && (input as { kind?: unknown }).kind === 'events'
    && Array.isArray((input as { events?: unknown }).events);
}

function handleSseOpenResult(response: Response, result: HostedSseOpenResult): void {
  if (result.kind === 'attached' || result.kind === 'resync') return;
  if (result.kind === 'bad-request') {
    apiFailure(response, 400, result.code, result.message);
    return;
  }
  if (result.kind === 'not-owned') {
    apiFailure(response, 404, 'NOT_FOUND', 'hosted stream was not found');
    return;
  }
  if (result.kind === 'unavailable') {
    apiFailure(response, 503, result.code, 'hosted stream is unavailable');
    return;
  }
  apiFailure(
    response,
    result.code === 'HOSTED_OVERLOADED' ? 429 : 503,
    result.code,
    'hosted stream capacity is exhausted',
  );
}

function requestState(response: Response): HostedRequestState {
  const state = response.locals.hosted as HostedRequestState | undefined;
  if (state == null) throw new HostedHttpError('HOSTED_AUTH_REQUIRED', 'hosted authentication is required', 401);
  return state;
}

function identityState(response: Response): HostedIdentityRequestState {
  const state = response.locals.hostedIdentity as HostedIdentityRequestState | undefined;
  if (state == null) {
    throw new HostedHttpError(
      'HOSTED_AUTH_REQUIRED',
      'hosted authentication is required',
      401,
    );
  }
  return state;
}

function routeParam(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== 'string') {
    throw new HostedHttpError('BAD_REQUEST', 'hosted route parameter is invalid', 400);
  }
  return value;
}

function assertRunReferences(
  run: Record<string, unknown>,
  feedback: HostedRunFeedbackRequest,
): void {
  if (
    run.projectId !== feedback.projectId
    || run.conversationId !== feedback.conversationId
    || run.assistantMessageId !== feedback.assistantMessageId
  ) {
    throw new HostedRuntimeError('NOT_FOUND', 'hosted run was not found');
  }
}

function hostedRunEvents(
  channel: string,
  payload: Record<string, unknown>,
  context: {
    readonly agentId: string;
    readonly model: string;
    readonly projectId: string;
    readonly reasoning: string | null;
    readonly runId: string;
  },
): {
  internalEvent: {
    event: string;
    data: Record<string, unknown>;
    milestone: HostedDurableEventMilestone | null;
  } | null;
  publicEvents: Array<{
    event: string;
    data: Record<string, unknown>;
    milestone: HostedDurableEventMilestone | null;
  }>;
} {
  const ts = Number.isSafeInteger(payload.ts) ? payload.ts : Date.now();
  const runId = context.runId;
  if (payload.kind === 'run.lifecycle') {
    const status = String(payload.status);
    const internalEvent = {
      event: 'run.lifecycle',
      data: { ...payload, runId, status, ts },
      milestone: (status === 'created'
        ? 'run-created'
        : status === 'completed' || status === 'failed' || status === 'cancelled'
          ? 'terminal'
          : 'status-transition') as HostedDurableEventMilestone,
    };
    if (status === 'created') {
      return {
        internalEvent: null,
        publicEvents: [{
          event: 'start',
          data: {
            agentId: context.agentId,
            model: context.model,
            projectId: context.projectId,
            reasoning: context.reasoning,
            runId,
          },
          milestone: 'run-created',
        }],
      };
    }
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      const endStatus = status === 'completed'
        ? 'succeeded'
        : status === 'cancelled'
          ? 'canceled'
          : 'failed';
      const errorCode = API_ERROR_CODES.includes(payload.errorCode as ApiErrorCode)
        ? payload.errorCode as ApiErrorCode
        : 'INTERNAL_ERROR';
      return {
        internalEvent,
        publicEvents: [
          ...(status === 'failed'
            ? [{
                event: 'error',
                data: {
                  message: 'hosted run failed',
                  error: createApiError(errorCode, 'hosted run failed'),
                },
                milestone: 'terminal' as const,
              }]
            : []),
          {
            event: 'end',
            data: {
              code: Number.isInteger(payload.exitCode) ? payload.exitCode : null,
              signal: typeof payload.signal === 'string' ? payload.signal : null,
              status: endStatus,
            },
            milestone: 'terminal' as const,
          },
        ],
      };
    }
    return { internalEvent, publicEvents: [] };
  }
  if (typeof payload.kind === 'string') {
    return {
      internalEvent: {
        event: /^[A-Za-z0-9_.-]{1,64}$/u.test(channel) ? channel : 'agent',
        data: { ...payload, runId, ts },
        milestone: payload.kind.startsWith('ui.') ? 'status-transition' : null,
      },
      publicEvents: [],
    };
  }
  const text = typeof payload.delta === 'string'
    ? payload.delta
    : typeof payload.text === 'string'
      ? payload.text
      : typeof payload.content === 'string'
        ? payload.content
        : null;
  if (text != null) {
    return {
      internalEvent: {
        event: 'agent.message',
        data: { kind: 'agent.message', runId, text, ts },
        milestone: null,
      },
      publicEvents: [{
        event: 'agent',
        data: { type: 'text_delta', delta: text },
        milestone: null,
      }],
    };
  }
  return {
    internalEvent: null,
    publicEvents: [],
  };
}

function hostedGenUiSurfaces(
  run: Record<string, unknown>,
  events: readonly unknown[],
): Array<HostedGenUiSurface & { spec: Record<string, unknown> | null }> {
  if (
    typeof run.id !== 'string'
    || typeof run.projectId !== 'string'
  ) return [];
  const surfaces = new Map<
    string,
    HostedGenUiSurface & { spec: Record<string, unknown> | null }
  >();
  for (const raw of events) {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const event = raw as Record<string, unknown>;
    if (
      event.kind === 'ui.surface_requested'
      && typeof event.surfaceId === 'string'
      && ['form', 'choice', 'confirmation', 'oauth-prompt'].includes(
        String(event.surfaceKind),
      )
    ) {
      const payload = event.payload != null
        && typeof event.payload === 'object'
        && !Array.isArray(event.payload)
        ? event.payload as Record<string, unknown>
        : {};
      const requestedAt = Number.isSafeInteger(event.ts) ? event.ts as number : Date.now();
      const persist = ['run', 'conversation', 'project'].includes(String(payload.persist))
        ? payload.persist as HostedGenUiSurface['persist']
        : 'run';
      const surfaceId = event.surfaceId;
      surfaces.set(surfaceId, {
        id: `${run.id}-${surfaceId}`,
        projectId: run.projectId,
        conversationId: typeof run.conversationId === 'string' ? run.conversationId : null,
        runId: run.id,
        surfaceId,
        kind: event.surfaceKind as HostedGenUiSurface['kind'],
        persist,
        value: null,
        status: 'pending',
        respondedBy: null,
        requestedAt,
        respondedAt: null,
        expiresAt: Number.isSafeInteger(payload.expiresAt)
          ? payload.expiresAt as number
          : null,
        spec: {
          id: surfaceId,
          kind: event.surfaceKind,
          persist,
          ...(payload.schema === undefined ? {} : { schema: payload.schema }),
          ...(payload.prompt === undefined ? {} : { prompt: payload.prompt }),
          ...(payload.timeout === undefined ? {} : { timeout: payload.timeout }),
          ...(payload.onTimeout === undefined ? {} : { onTimeout: payload.onTimeout }),
          ...(payload.default === undefined ? {} : { default: payload.default }),
        },
      });
      continue;
    }
      if (
        event.kind === 'ui.surface_responded'
      && typeof event.surfaceId === 'string'
    ) {
      const current = surfaces.get(event.surfaceId);
      if (current == null) continue;
      surfaces.set(event.surfaceId, {
        ...current,
        value: event.value as HostedGenUiSurface['value'],
        status: 'resolved',
        respondedBy: 'user',
        respondedAt: Number.isSafeInteger(event.ts) ? event.ts as number : Date.now(),
      });
    } else if (
      event.kind === 'ui.surface_invalidated'
      && typeof event.surfaceId === 'string'
    ) {
      const existing = surfaces.get(event.surfaceId);
      if (existing == null) continue;
      surfaces.set(event.surfaceId, {
        ...existing,
        status: 'invalidated',
        respondedAt: Number.isSafeInteger(event.ts) ? event.ts as number : Date.now(),
      });
    }
  }
  return [...surfaces.values()];
}

function providerDestinations(
  overrides: Partial<Record<HostedProviderId, string>> | undefined,
): Record<HostedProviderId, string> {
  const destinations = Object.fromEntries(
    HOSTED_PROVIDER_CATALOGUE.map((entry) => [entry.id, entry.baseUrl]),
  ) as Record<HostedProviderId, string>;
  if (overrides == null) return destinations;
  for (const id of HOSTED_PROVIDER_IDS) {
    const override = overrides[id];
    if (override !== undefined) destinations[id] = loopbackFixtureOrigin(override);
  }
  return destinations;
}

function loopbackFixtureOrigin(input: string): string {
  const parsed = new URL(input);
  if (
    parsed.protocol !== 'http:'
    || !['127.0.0.1', '::1', 'localhost'].includes(parsed.hostname)
    || parsed.origin !== input
  ) {
    throw new Error('hosted provider test destinations must be exact loopback HTTP origins');
  }
  return parsed.origin;
}

function exactOrigin(input: string): string {
  const parsed = new URL(input);
  if (
    !['http:', 'https:'].includes(parsed.protocol)
    || parsed.origin !== input
    || parsed.username !== ''
    || parsed.password !== ''
  ) {
    throw new Error('hosted public origin must be an exact HTTP(S) origin');
  }
  return parsed.origin;
}

function validateSessionKey(value: string): void {
  const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.alloc(0);
  if (
    bytes.length < 1
    || bytes.length > 1_024
    || bytes.toString('utf8') !== value
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new HostedHttpError('HOSTED_AUTH_INVALID', 'hosted identity session is invalid', 401);
  }
}

function sessionBindingKey(identity: HostedResolvedIdentity): string {
  return `${Buffer.byteLength(identity.userKey, 'utf8')}:${identity.userKey}${identity.sessionKey}`;
}

function constantTimeEqual(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(supplied, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function removeExpiredCsrf(states: Map<string, CsrfState>): void {
  const now = Date.now();
  for (const [binding, state] of states) {
    if (state.expiresAt <= now) states.delete(binding);
  }
}

function closedObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HostedHttpError('BAD_REQUEST', 'hosted request body is invalid', 400);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new HostedHttpError('BAD_REQUEST', 'hosted request body contains unsupported fields', 400);
  }
  return record;
}

function providerId(value: unknown): HostedProviderId {
  if (typeof value !== 'string' || !HOSTED_PROVIDER_IDS.includes(value as HostedProviderId)) {
    throw new HostedHttpError('HOSTED_PROVIDER_INVALID', 'hosted provider is invalid', 400);
  }
  return value as HostedProviderId;
}

function providerSecret(value: unknown): string {
  if (typeof value !== 'string') invalidProviderCredential();
  const bytes = Buffer.from(value, 'utf8');
  if (
    bytes.length < 1
    || bytes.length > MAX_PROVIDER_SECRET_BYTES
    || bytes.toString('utf8') !== value
    || /[\u0000\r\n]/u.test(value)
  ) invalidProviderCredential();
  return value;
}

function invalidProviderCredential(): never {
  throw new HostedHttpError('HOSTED_PROVIDER_INVALID', 'hosted provider credential is invalid', 400);
}

function providerEntry(provider: HostedProviderId): ProviderEntry {
  const entry = HOSTED_PROVIDER_CATALOGUE.find((candidate) => candidate.id === provider);
  if (entry == null) throw new HostedHttpError('HOSTED_PROVIDER_INVALID', 'hosted provider is invalid', 400);
  return entry;
}

async function testProvider(
  entry: ProviderEntry,
  credential: HostedProviderCredential,
  baseUrl: string,
  signal: AbortSignal,
): Promise<void> {
  const body = JSON.stringify({
    model: entry.model,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'Reply with OK' }],
    stream: false,
  });
  let result: { status: number; body: string };
  try {
    result = await providerRequest(new URL('/v1/messages', baseUrl), credential.key, body, signal);
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new HostedHttpError(
        'HOSTED_PROVIDER_TEST_TIMED_OUT',
        'hosted provider test timed out',
        504,
      );
    }
    throw new HostedHttpError('HOSTED_PROVIDER_TEST_FAILED', 'hosted provider test failed', 502);
  }
  if (result.status < 200 || result.status >= 300) {
    throw new HostedHttpError('HOSTED_PROVIDER_TEST_FAILED', 'hosted provider test failed', 502);
  }
  try {
    const parsed = JSON.parse(result.body) as { content?: unknown; id?: unknown };
    if (typeof parsed.id !== 'string' || !Array.isArray(parsed.content)) throw new Error('invalid shape');
  } catch {
    throw new HostedHttpError('HOSTED_PROVIDER_TEST_FAILED', 'hosted provider test failed', 502);
  }
}

function providerRequest(
  url: URL,
  key: string,
  body: string,
  signal: AbortSignal,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    let settled = false;
    let connected = false;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;
    let callTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = (error?: unknown, value?: { status: number; body: string }): void => {
      if (settled) return;
      settled = true;
      if (connectTimer != null) clearTimeout(connectTimer);
      if (callTimer != null) clearTimeout(callTimer);
      signal.removeEventListener('abort', onAbort);
      if (error === undefined && value !== undefined) resolve(value);
      else reject(error ?? new Error('provider request failed'));
    };
    const request = transport.request(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-api-key': key,
      },
    }, (response: IncomingMessage) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > MAX_PROVIDER_RESPONSE_BYTES) {
          request.destroy(new Error('hosted provider response exceeded the fixed limit'));
          return;
        }
        chunks.push(buffer);
      });
      response.once('end', () => finish(undefined, {
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
      response.once('error', finish);
    });
    const onAbort = (): void => {
      request.destroy(signal.reason instanceof Error
        ? signal.reason
        : new Error('hosted provider request aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    request.once('socket', (socket: Socket) => {
      const onConnected = (): void => {
        connected = true;
        if (connectTimer != null) clearTimeout(connectTimer);
      };
      if (!socket.connecting) onConnected();
      else socket.once(url.protocol === 'https:' ? 'secureConnect' : 'connect', onConnected);
      connectTimer = setTimeout(() => {
        if (!connected) request.destroy(Object.assign(new Error('provider connect timed out'), { code: 'ETIMEDOUT' }));
      }, PROVIDER_CONNECT_TIMEOUT_MS);
      connectTimer.unref?.();
    });
    request.once('error', finish);
    callTimer = setTimeout(() => {
      request.destroy(Object.assign(new Error('provider call timed out'), { code: 'ETIMEDOUT' }));
    }, PROVIDER_CALL_TIMEOUT_MS);
    callTimer.unref?.();
    if (signal.aborted) onAbort();
    else request.end(body);
  });
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (
    (error as NodeJS.ErrnoException).code === 'ETIMEDOUT'
    || /timed out|timeout/iu.test(error.message)
  );
}

function isJsonBodyError(error: unknown): error is { type?: string } {
  return error instanceof SyntaxError
    || (typeof error === 'object' && error != null && 'type' in error);
}

function apiFailure(
  response: Response,
  status: number,
  code: ApiErrorCode,
  message: string,
  requestId?: string,
): void {
  sendApiError(response, status, createApiError(code, message, requestId === undefined ? {} : { requestId }));
}

function listen(app: express.Express, port: number, host: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host);
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.once('listening', () => {
      server.off('error', onError);
      resolve(server);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => error == null ? resolve() : reject(error));
    server.closeAllConnections();
  });
}

async function loadHostedCatalogue(resourceRoot?: string): Promise<HostedCatalogueSnapshot> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const workspaceRoot = resolveProjectRoot(moduleDir);
  const root = exactResourceRoot(
    resourceRoot ?? process.env.OD_RESOURCE_ROOT ?? workspaceRoot,
  );
  const skillsRoot = path.join(root, 'skills');
  const designSystemsRoot = path.join(root, 'design-systems');
  const skills = (await listSkills([skillsRoot])).map((skill) => ({
    ...skill,
    source: 'built-in' as const,
  }));
  const designSystems = await listDesignSystems(designSystemsRoot, {
    source: 'built-in',
    isEditable: false,
    defaultStatus: 'published',
  });
  const skillFiles = Object.fromEntries(skills.map((skill) => [
    skill.id,
    collectCatalogueFiles(skillsRoot, skill.dir),
  ]));
  const designSystemFiles = Object.fromEntries(designSystems.map(({ id }) => [
    id,
    collectDesignSystemToolFiles(designSystemsRoot, id),
  ]));
  return {
    agents: [{ id: 'pi', name: 'Pi', source: 'built-in' }],
    skills,
    skillFiles,
    designSystems,
    designSystemFiles,
  };
}

function collectDesignSystemToolFiles(
  root: string,
  id: string,
): Array<{ path: string; content: string }> {
  const exactRoot = fs.realpathSync(root);
  const directory = path.join(exactRoot, id);
  const directoryStat = fs.lstatSync(directory);
  const exactDirectory = fs.realpathSync(directory);
  if (
    !directoryStat.isDirectory()
    || directoryStat.isSymbolicLink()
    || !sameServerPath(directory, exactDirectory)
    || !sameServerPath(path.dirname(exactDirectory), exactRoot)
  ) throw new Error('hosted design-system catalogue escaped its immutable root');
  const manifestContent = readDesignSystemToolFile(exactDirectory, 'manifest.json');
  let manifest: unknown;
  try { manifest = JSON.parse(manifestContent); } catch {
    throw new Error('hosted design-system manifest is invalid');
  }
  if (manifest == null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('hosted design-system manifest is invalid');
  }
  const record = manifest as Record<string, unknown>;
  const paths = new Set<string>(['manifest.json']);
  const add = (value: unknown): void => {
    if (typeof value === 'string') paths.add(value);
  };
  if (record.files != null && typeof record.files === 'object' && !Array.isArray(record.files)) {
    for (const value of Object.values(record.files)) add(value);
  }
  add(record.usage);
  add(record.componentsManifest);
  if (
    record.preview != null
    && typeof record.preview === 'object'
    && !Array.isArray(record.preview)
    && Array.isArray((record.preview as Record<string, unknown>).pages)
  ) {
    for (const page of (record.preview as { pages: unknown[] }).pages) {
      if (page != null && typeof page === 'object' && !Array.isArray(page)) {
        add((page as Record<string, unknown>).path);
      }
    }
  }
  if (
    record.sourceFiles != null
    && typeof record.sourceFiles === 'object'
    && !Array.isArray(record.sourceFiles)
  ) {
    for (const value of Object.values(record.sourceFiles)) add(value);
  }
  if (Array.isArray(record.fonts)) {
    for (const font of record.fonts) {
      if (font != null && typeof font === 'object' && !Array.isArray(font)) {
        add((font as Record<string, unknown>).file);
      }
    }
  }
  if (paths.size > 128) throw new Error('hosted design-system manifest is too large');
  return [...paths].sort().map((relativePath) => ({
    path: relativePath,
    content: relativePath === 'manifest.json'
      ? manifestContent
      : readDesignSystemToolFile(exactDirectory, relativePath),
  }));
}

function readDesignSystemToolFile(root: string, relativePath: string): string {
  if (
    Buffer.byteLength(relativePath, 'utf8') < 1
    || Buffer.byteLength(relativePath, 'utf8') > 1_024
    || relativePath.startsWith('/')
    || relativePath.includes('\\')
    || /^[A-Za-z]:/u.test(relativePath)
    || relativePath.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) throw new Error('hosted design-system manifest path is invalid');
  let current = root;
  for (const segment of relativePath.split('/')) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error('hosted design-system catalogue contains a link');
  }
  const stat = fs.statSync(current);
  const resolved = fs.realpathSync(current);
  const relative = path.relative(root, resolved);
  if (
    !stat.isFile()
    || stat.size > 4 * 1024 * 1024
    || path.isAbsolute(relative)
    || relative === '..'
    || relative.startsWith(`..${path.sep}`)
  ) throw new Error('hosted design-system catalogue file is invalid');
  const content = fs.readFileSync(resolved);
  const decoded = content.toString('utf8');
  if (!content.equals(Buffer.from(decoded, 'utf8'))) {
    throw new Error('hosted design-system catalogue file is not UTF-8');
  }
  return decoded;
}

function exactResourceRoot(input: string): string {
  const requested = path.resolve(input);
  const stat = fs.lstatSync(requested);
  const resolved = fs.realpathSync(requested);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !sameServerPath(requested, resolved)) {
    throw new Error('hosted resource root must be an exact directory');
  }
  return resolved;
}

function collectCatalogueFiles(root: string, directory: string): Array<{
  path: string;
  kind: 'directory' | 'file';
  size: number | null;
}> {
  const exactRoot = fs.realpathSync(root);
  const exactDirectory = fs.realpathSync(directory);
  const relativeDirectory = path.relative(exactRoot, exactDirectory);
  if (
    path.isAbsolute(relativeDirectory)
    || relativeDirectory === '..'
    || relativeDirectory.startsWith(`..${path.sep}`)
  ) throw new Error('hosted skill catalogue escaped its immutable root');
  const files: Array<{ path: string; kind: 'directory' | 'file'; size: number | null }> = [];
  const visit = (current: string, prefix: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('hosted skill catalogue contains a link');
      const file = path.join(current, entry.name);
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        files.push({ path: relative, kind: 'directory', size: null });
        if (files.length > 500) throw new Error('hosted skill catalogue is too large');
        visit(file, relative);
      } else if (entry.isFile()) {
        files.push({ path: relative, kind: 'file', size: fs.statSync(file).size });
        if (files.length > 500) throw new Error('hosted skill catalogue is too large');
      }
    }
  };
  visit(exactDirectory, '');
  return files;
}

function sameServerPath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
