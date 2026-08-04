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
