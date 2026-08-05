/**
 * Server-derived identity carried through the hosted request/runtime boundary.
 *
 * `userKey` is an immutable internal identity. `storageKey` is the separately
 * validated, path-safe namespace used by hosted storage. Neither value is
 * accepted from a client request.
 */
export interface HostedAuthContext {
  readonly userKey: string;
  readonly storageKey: string;
  readonly requestId: string;
  readonly displayName?: string;
}

export const HOSTED_PROVIDER_IDS = [
  'anthropic',
  'vercel-ai-gateway',
] as const;

export type HostedProviderId = (typeof HOSTED_PROVIDER_IDS)[number];

export interface HostedProviderDescriptor {
  readonly id: HostedProviderId;
  readonly model: string;
}

/** Bootstrap authority for browser and CLI hosted requests. */
export interface HostedSessionResponse {
  readonly publicOrigin: string;
  readonly csrfToken: string;
  readonly csrfExpiresAt: number;
  readonly providers: readonly HostedProviderDescriptor[];
}

export interface HostedProviderStatusResponse {
  readonly provider: HostedProviderId | null;
  readonly configured: boolean;
}

export interface HostedProviderSetRequest {
  readonly provider: HostedProviderId;
  /** Ephemeral secret. It is accepted as input and is never returned. */
  readonly key: string;
}

export interface HostedProviderSetResponse {
  readonly result: 'set';
  readonly provider: HostedProviderId;
  readonly configured: true;
}

export interface HostedProviderTestRequest {
  readonly provider: HostedProviderId;
}

export interface HostedProviderTestResponse {
  readonly result: 'passed';
  readonly provider: HostedProviderId;
  readonly model: string;
}

export interface HostedProviderClearResponse {
  readonly result: 'cleared';
  readonly provider: null;
  readonly configured: false;
}

export const HOSTED_CSRF_HEADER = 'X-Open-Design-CSRF' as const;
