import { createHash, randomBytes } from 'node:crypto';

import type {
  HostedDesignSystemReadResponse,
  HostedDesignSystemReadV1,
} from '@open-design/contracts';

export const HOSTED_DESIGN_SYSTEM_READ_ENDPOINT = '/api/tools/design-systems/read' as const;
export const HOSTED_DESIGN_SYSTEM_GRANT_MAX_TTL_MS = 31 * 60 * 1_000;
export const HOSTED_DESIGN_SYSTEM_CONTENT_MAX_BYTES = 4 * 1024 * 1024;

const MAX_PATH_BYTES = 1_024;
const MAX_BINDING_BYTES = 1_024;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

export type HostedDesignSystemToolAdapterErrorCode =
  | 'BAD_REQUEST'
  | 'FORBIDDEN'
  | 'INTERNAL_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED';

export class HostedDesignSystemToolAdapterError extends Error {
  readonly code: HostedDesignSystemToolAdapterErrorCode;

  constructor(code: HostedDesignSystemToolAdapterErrorCode, message: string) {
    super(message);
    this.name = 'HostedDesignSystemToolAdapterError';
    this.code = code;
  }
}

export interface HostedDesignSystemToolCatalogueEntry {
  readonly id: string;
  readonly files: readonly {
    readonly path: string;
    readonly content: string;
  }[];
}

export interface HostedDesignSystemToolBinding {
  readonly userKey: string;
  readonly runId: string;
  readonly projectId: string;
  readonly endpoint: typeof HOSTED_DESIGN_SYSTEM_READ_ENDPOINT;
  readonly generation: number;
  readonly designSystemId: string;
}

export interface HostedDesignSystemToolAuthInput {
  readonly token: string | null;
  readonly cookiePresent: boolean;
  readonly csrfPresent: boolean;
  readonly origin: string | null;
  /** Server-resolved runtime binding; never populate this from request data. */
  readonly binding: HostedDesignSystemToolBinding | null;
}

export interface HostedDesignSystemToolGrant {
  readonly token: string;
  readonly expiresAt: string;
}

type StoredGrant = {
  readonly binding: HostedDesignSystemToolBinding;
  readonly allowedPaths: ReadonlySet<string>;
  readonly expiresAtMs: number;
  readonly timer: NodeJS.Timeout;
};

type FixedDesignSystem = {
  readonly files: ReadonlyMap<string, string>;
};

function fail(
  code: HostedDesignSystemToolAdapterErrorCode,
  message: string,
): never {
  throw new HostedDesignSystemToolAdapterError(code, message);
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function boundedString(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string'
    && Buffer.byteLength(value, 'utf8') > 0
    && Buffer.byteLength(value, 'utf8') <= maxBytes
    && !CONTROL_CHARACTERS.test(value);
}

function canonicalRelativePath(value: unknown): value is string {
  return boundedString(value, MAX_PATH_BYTES)
    && !value.startsWith('/')
    && !value.includes('\\')
    && !/^[A-Za-z]:/u.test(value)
    && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function validDesignSystemId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 128
    && /^(?!\.+$)[A-Za-z0-9._-]+$/u.test(value);
}

function validateBinding(binding: HostedDesignSystemToolBinding): void {
  if (
    !boundedString(binding.userKey, MAX_BINDING_BYTES)
    || !boundedString(binding.runId, MAX_BINDING_BYTES)
    || !boundedString(binding.projectId, MAX_BINDING_BYTES)
    || binding.endpoint !== HOSTED_DESIGN_SYSTEM_READ_ENDPOINT
    || !Number.isSafeInteger(binding.generation)
    || binding.generation < 1
    || !validDesignSystemId(binding.designSystemId)
  ) fail('INTERNAL_ERROR', 'design-system grant binding is invalid');
}

function sameBinding(
  expected: HostedDesignSystemToolBinding,
  actual: HostedDesignSystemToolBinding,
): boolean {
  return expected.userKey === actual.userKey
    && expected.runId === actual.runId
    && expected.projectId === actual.projectId
    && expected.endpoint === actual.endpoint
    && expected.generation === actual.generation
    && expected.designSystemId === actual.designSystemId;
}

function fixedCatalogue(
  entries: readonly HostedDesignSystemToolCatalogueEntry[],
): ReadonlyMap<string, FixedDesignSystem> {
  const catalogue = new Map<string, FixedDesignSystem>();
  for (const entry of entries) {
    if (!validDesignSystemId(entry.id) || catalogue.has(entry.id) || !Array.isArray(entry.files)) {
      fail('INTERNAL_ERROR', 'design-system catalogue is invalid');
    }
    const files = new Map<string, string>();
    for (const file of entry.files) {
      if (
        !canonicalRelativePath(file.path)
        || files.has(file.path)
        || typeof file.content !== 'string'
        || Buffer.byteLength(file.content, 'utf8') > HOSTED_DESIGN_SYSTEM_CONTENT_MAX_BYTES
      ) fail('INTERNAL_ERROR', 'design-system catalogue is invalid');
      files.set(file.path, file.content);
    }
    catalogue.set(entry.id, { files });
  }
  return catalogue;
}

function exactReadRequest(value: unknown): HostedDesignSystemReadV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('BAD_REQUEST', 'design-system read request is invalid');
  }
  const keys = Reflect.ownKeys(value);
  if (
    !keys.includes('path')
    || keys.some((key) => key !== 'path' && key !== 'designSystemId')
    || !canonicalRelativePath((value as Record<string, unknown>).path)
  ) fail('BAD_REQUEST', 'design-system read request is invalid');
  const designSystemId = (value as Record<string, unknown>).designSystemId;
  if (designSystemId === undefined) return { path: (value as { path: string }).path };
  if (!validDesignSystemId(designSystemId)) {
    fail('BAD_REQUEST', 'design-system read request is invalid');
  }
  return { path: (value as { path: string }).path, designSystemId };
}

export function createHostedDesignSystemToolAdapter(options: {
  readonly catalogue: readonly HostedDesignSystemToolCatalogueEntry[];
  readonly now?: () => number;
}) {
  const catalogue = fixedCatalogue(options.catalogue);
  const grants = new Map<string, StoredGrant>();
  const now = options.now ?? Date.now;
  let disposed = false;

  const revokeHash = (hash: string): boolean => {
    const stored = grants.get(hash);
    if (!stored) return false;
    clearTimeout(stored.timer);
    grants.delete(hash);
    return true;
  };

  const mintGrant = (
    binding: HostedDesignSystemToolBinding,
    grantOptions: { readonly ttlMs?: number } = {},
  ): HostedDesignSystemToolGrant => {
    if (disposed) fail('INTERNAL_ERROR', 'design-system tool adapter is closed');
    validateBinding(binding);
    const fixed = catalogue.get(binding.designSystemId);
    if (!fixed) fail('INTERNAL_ERROR', 'design-system grant catalogue is invalid');
    const ttlMs = grantOptions.ttlMs ?? HOSTED_DESIGN_SYSTEM_GRANT_MAX_TTL_MS;
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > HOSTED_DESIGN_SYSTEM_GRANT_MAX_TTL_MS) {
      fail('INTERNAL_ERROR', 'design-system grant lifetime is invalid');
    }
    let token: string;
    let hash: string;
    do {
      token = `odds_${randomBytes(32).toString('base64url')}`;
      hash = tokenHash(token);
    } while (grants.has(hash));
    const expiresAtMs = now() + ttlMs;
    const timer = setTimeout(() => revokeHash(hash), ttlMs);
    timer.unref?.();
    grants.set(hash, {
      binding: Object.freeze({ ...binding }),
      allowedPaths: new Set(fixed.files.keys()),
      expiresAtMs,
      timer,
    });
    return Object.freeze({ token, expiresAt: new Date(expiresAtMs).toISOString() });
  };

  const authorize = (auth: HostedDesignSystemToolAuthInput): StoredGrant => {
    if (
      disposed
      || !auth
      || auth.cookiePresent !== false
      || auth.csrfPresent !== false
      || auth.origin !== null
      || !auth.binding
      || typeof auth.token !== 'string'
      || auth.token.length === 0
    ) fail('UNAUTHORIZED', 'design-system broker authorization failed');
    const hash = tokenHash(auth.token);
    const grant = grants.get(hash);
    if (!grant) fail('UNAUTHORIZED', 'design-system broker authorization failed');
    if (now() >= grant.expiresAtMs) {
      revokeHash(hash);
      fail('UNAUTHORIZED', 'design-system broker authorization failed');
    }
    if (!sameBinding(auth.binding, grant.binding)) {
      fail('FORBIDDEN', 'design-system broker binding does not match');
    }
    return grant;
  };

  const read = async (input: {
    readonly auth: HostedDesignSystemToolAuthInput;
    readonly readBody: () => unknown | Promise<unknown>;
  }): Promise<HostedDesignSystemReadResponse> => {
    const grant = authorize(input.auth);
    let rawBody: unknown;
    try {
      rawBody = await input.readBody();
    } catch {
      fail('BAD_REQUEST', 'design-system read request is invalid');
    }
    const request = exactReadRequest(rawBody);
    if (
      request.designSystemId !== undefined
      && request.designSystemId !== grant.binding.designSystemId
    ) fail('FORBIDDEN', 'design-system is outside the broker grant');
    if (!grant.allowedPaths.has(request.path)) {
      fail('NOT_FOUND', 'design-system content is not available');
    }
    const content = catalogue.get(grant.binding.designSystemId)?.files.get(request.path);
    if (content === undefined) fail('NOT_FOUND', 'design-system content is not available');
    return Object.freeze({ content });
  };

  const revoke = (token: string | null | undefined): boolean => (
    typeof token === 'string' && token.length > 0
      ? revokeHash(tokenHash(token))
      : false
  );

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const grant of grants.values()) clearTimeout(grant.timer);
    grants.clear();
  };

  return { mintGrant, read, revoke, dispose };
}
