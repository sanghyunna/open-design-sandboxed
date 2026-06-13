// PostHog browser client wrapper. Telemetry network egress is hard-removed in
// this fork: posthog-js is never loaded and `/api/analytics/config` is never
// fetched, so `client` stays permanently null and every entry point below is a
// type-clean no-op. The full surface is retained (no signature changes) so the
// `analytics.track()` callers scattered across the app stay compiling.

import type { PostHog } from 'posthog-js';
import {
  type AnalyticsClientType,
  type AnalyticsConfigureGlobals,
} from '@open-design/contracts/analytics';

interface AnalyticsContext {
  anonymousId: string;
  sessionId: string;
  clientType: AnalyticsClientType;
  locale: string;
  appVersion: string;
}

// Permanently null: the init path that used to assign this was removed when
// telemetry egress was hard-removed. Still read by the no-op guards below.
let client: PostHog | null = null;
let resolvedDeviceId: string | null = null;
// Latest configure-state triplet. Re-registered on the PostHog client as
// soon as it changes so every subsequent event inherits the current values.
let configureGlobals: AnalyticsConfigureGlobals = {
  has_available_configure_cli: false,
  configure_type: 'unknown',
  configure_availability: 'unknown',
};
// Snapshot of the super-property payload sent on the most recent `loaded()`
// init. `reset()` clears posthog-js's persisted super-properties as well as
// the distinct_id, so privacy → metrics off → on, or a Delete-my-data
// rotation (applyIdentity()), would otherwise resume capture without
// `event_schema_version`, `device_id`, `session_id`, `locale`, or the
// configure-state globals. We restash this on init and re-register it
// after every reset()/identify() so every subsequent event keeps the
// v2 schema contract.
let lastRegisterPayload: Record<string, unknown> | null = null;

// Returns the installationId the daemon stamped on /api/analytics/config
// after the user opted in via Privacy → "Share usage data". The provider
// uses this in preference to its locally-generated UUID so PostHog,
// Langfuse, and any future sink share a single anonymous identity.
//
// Kept under the legacy name for callers that still import it; new code
// should prefer `getResolvedDeviceId`.
export function getResolvedAnonymousId(): string | null {
  return resolvedDeviceId;
}

export function getResolvedDeviceId(): string | null {
  return resolvedDeviceId;
}

// Web-side accessor for the daemon header bridge: when the web client POSTs
// to /api/runs the daemon needs to know what device_id to stamp on its
// own server-side captures.
export function getConfigureGlobals(): AnalyticsConfigureGlobals {
  return configureGlobals;
}

// Called from the AnalyticsProvider when the configure-state triplet changes
// (mode switch, BYOK key save, CLI rescan). The values are registered on the
// PostHog client so every subsequent capture inherits them — no per-event
// boilerplate needed.
export function setConfigureGlobals(next: AnalyticsConfigureGlobals): void {
  configureGlobals = { ...next };
  // Keep the cached register payload aligned so a future reset/identify
  // flow that calls `restoreSuperProperties()` uses the LATEST configure
  // state, not the stale snapshot captured during the initial `loaded()`.
  if (lastRegisterPayload) {
    lastRegisterPayload = {
      ...lastRegisterPayload,
      ...(configureGlobals as unknown as Record<string, unknown>),
    };
  }
  if (!client) return;
  try {
    client.register(configureGlobals as unknown as Record<string, unknown>);
  } catch {
    // best-effort — capture should never throw out of this path.
  }
}

// AMR account id, registered as the `user_id` public param once sign-in
// state is known. This is the only cross-project join key between the main
// app's PostHog project and the AMR project (whose events carry the same
// id as `app_user_id`), so it must survive reset()/identify() flows the
// same way the configure globals do.
let registeredUserId: string | null = null;

// Called from the AnalyticsProvider when the AMR login status resolves
// (boot fetch or a login/logout mid-session). Passing null unregisters the
// param so events after a logout stop carrying a stale account id.
export function setAnalyticsUserId(userId: string | null): void {
  if (registeredUserId === userId) return;
  registeredUserId = userId;
  if (lastRegisterPayload) {
    if (userId) {
      lastRegisterPayload = { ...lastRegisterPayload, user_id: userId };
    } else {
      const { user_id: _dropped, ...rest } = lastRegisterPayload;
      lastRegisterPayload = rest;
    }
  }
  if (!client) return;
  try {
    if (userId) {
      client.register({ user_id: userId });
    } else {
      client.unregister('user_id');
    }
  } catch {
    // best-effort — capture should never throw out of this path.
  }
}

// Historically fetched `/api/analytics/config` once to bridge the
// exception-tracking module to the PostHog ingest key/host. That egress is
// hard-removed in this fork; the function is retained as a no-op so callers
// (AnalyticsProvider boot effect) keep compiling. The error tracker's
// `window.error` / `unhandledrejection` listeners still install at module
// load, but with no context set they only buffer in memory and never send
// (see error-tracking.ts).
export function bootstrapExceptionTracking(_context: AnalyticsContext): Promise<void> {
  // Telemetry egress is hard-removed in this fork. The error tracker is never
  // bridged to `/api/analytics/config`, so no exception-tracking context is
  // ever set and the buffered events never dispatch (see error-tracking.ts).
  return Promise.resolve();
}

export async function getAnalyticsClient(
  _context: AnalyticsContext,
): Promise<PostHog | null> {
  // Telemetry egress is hard-removed in this fork. posthog-js is never
  // loaded and `/api/analytics/config` is never fetched, so the client stays
  // permanently null. Every other export early-returns on `if (!client)`, so
  // the analytics surface remains a type-clean no-op for all callers.
  return null;
}

// Called from the AnalyticsProvider when the user toggles Privacy →
// metrics off so events stop flowing immediately, before the next
// reload re-reads /api/analytics/config. The posthog-js client persists
// its opt-out flag in localStorage; subsequent capture() calls become
// no-ops until the user opts back in.
//
// `opt_out_capturing()` is a global gate — it halts not only explicit
// capture() calls but also autocapture, $pageview, $pageleave,
// $exception, web vitals, and dead clicks. One toggle covers every
// PostHog code path.
//
// On opt-out we ALSO call `posthog.reset()` to clear the persisted
// `ph_*_posthog` localStorage entry. Without this, the SDK keeps the
// old distinct_id; if the user later clicks Delete my data (which
// rotates installationId via the daemon) and toggles metrics back on,
// posthog-js would still think the user is the old id and stitch the
// new session to the deleted identity. reset() prevents that.
export function applyConsent(consentGranted: boolean): void {
  if (!client) return;
  try {
    if (consentGranted) {
      client.opt_in_capturing();
      // If the user previously toggled metrics off in this session, the
      // earlier opt-out path called reset() and wiped the persisted
      // super-properties. opt_in_capturing() only flips the consent flag
      // and does not re-run init(), so without this restore the next
      // capture would emit no event_schema_version / device_id /
      // session_id / locale / configure-state. See PR #2285 review
      // 2026-05-20 04:35.
      restoreSuperProperties();
    } else {
      client.opt_out_capturing();
      client.reset();
      resolvedDeviceId = null;
    }
  } catch {
    // best-effort — capture should never throw out of this path.
  }
}

// Called from the AnalyticsProvider when `config.installationId` rotates
// (Delete my data). posthog-js's `bootstrap.distinctID` only takes
// effect on first init; once the client is alive, identify() is the
// only way to switch identities. We pair it with reset() first so any
// $device_id stored under the OLD installation is wiped — the new
// session is fully decoupled from the deleted one.
export function applyIdentity(installationId: string | null): void {
  if (!client || !installationId) return;
  if (resolvedDeviceId === installationId) return;
  try {
    client.reset();
    client.identify(installationId);
    resolvedDeviceId = installationId;
    // reset() also clears the persisted super-properties from
    // posthog-js's localStorage cache. Re-register them with the new
    // distinct_id so the rest of this session keeps emitting v2-schema
    // events. See PR #2285 review 2026-05-20 04:35.
    restoreSuperProperties({ device_id: installationId });
  } catch {
    // best-effort — never propagate.
  }
}

// Push the cached super-property payload back onto the PostHog client. Used
// after reset()/identify() flows; takes an optional override patch so the
// caller can swap fields (e.g. a rotated device_id) without re-deriving the
// rest of the payload.
function restoreSuperProperties(patch?: Record<string, unknown>): void {
  if (!client || !lastRegisterPayload) return;
  const next = patch ? { ...lastRegisterPayload, ...patch } : lastRegisterPayload;
  lastRegisterPayload = next;
  try {
    client.register(next);
  } catch {
    // best-effort.
  }
}

export function capture(
  client: PostHog | null,
  args: {
    event: string;
    properties: Record<string, unknown>;
    insertId: string;
    requestId?: string | null;
  },
): void {
  if (!client) return;
  try {
    client.capture(args.event, {
      ...args.properties,
      event_id: args.insertId,
      // PostHog's official dedup key. The daemon mirrors result events with
      // the same $insert_id so duplicates from the dual-side capture pattern
      // get coalesced server-side.
      $insert_id: args.insertId,
      ...(args.requestId ? { request_id: args.requestId } : {}),
    });
  } catch {
    // Swallow — analytics failures must not propagate.
  }
}
