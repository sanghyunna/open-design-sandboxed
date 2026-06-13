// @vitest-environment jsdom
//
// Telemetry-removal regression test (formerly "PostHog session replay is
// enabled but privacy-masked").
//
// Client-side telemetry network egress is hard-removed in this fork:
// `getAnalyticsClient` is a permanent no-op that returns null WITHOUT ever
// dynamically importing posthog-js, so there is no session-replay config to
// assert anymore. The contract this test now pins is the absence of egress:
//
//   1. `getAnalyticsClient` resolves to null.
//   2. posthog-js's `init` is NEVER called (the SDK never loads).
//   3. `/api/analytics/config` is NEVER fetched.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const initMock = vi.fn();

vi.mock('posthog-js', () => {
  const stub = {
    init: (key: string, config: unknown) => {
      initMock(key, config);
      return stub;
    },
    register: () => undefined,
    opt_in_capturing: () => undefined,
    opt_out_capturing: () => undefined,
    reset: () => undefined,
    identify: () => undefined,
  };
  return { default: stub };
});

describe('client analytics: telemetry egress removed', () => {
  const originalFetch = globalThis.fetch;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    initMock.mockReset();
    vi.resetModules();
    // If anything tried to reach the daemon analytics config, this spy would
    // record it. It must stay untouched.
    fetchSpy = vi.fn(async () => new Response('not found', { status: 404 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('never loads posthog-js, never fetches the analytics config, and returns null', async () => {
    const { getAnalyticsClient } = await import('../src/analytics/client');
    const client = await getAnalyticsClient({
      anonymousId: 'anon-1',
      sessionId: 'sess-1',
      clientType: 'web',
      locale: 'en',
      appVersion: '1.2.3',
    });

    expect(client).toBeNull();
    // posthog-js's init must never run — the SDK is never loaded.
    expect(initMock).not.toHaveBeenCalled();
    // No call to /api/analytics/config (or anywhere else).
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
