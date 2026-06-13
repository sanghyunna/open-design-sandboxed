import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const posthogCapture = vi.hoisted(() => vi.fn());
const posthogShutdown = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('posthog-node', () => ({
  PostHog: vi.fn(function PostHogMock() {
    return {
      capture: posthogCapture,
      on: vi.fn(),
      shutdown: posthogShutdown,
    };
  }),
}));

describe('analytics telemetry environment', () => {
  // Corporate-fork cleanup: daemon-side PostHog phone-home is disabled
  // unconditionally (readPosthogConfig always returns null). These tests pin
  // the disabled cascade: the public config response reports disabled even
  // with POSTHOG_KEY set, and createAnalyticsService never constructs a
  // posthog-node client nor captures. The telemetry-env plumbing is retained
  // so the config response shape stays valid.
  it('reports analytics disabled in public config even when POSTHOG_KEY is set', async () => {
    const { readPublicConfigResponse } = await import('../src/analytics.js');

    expect(readPublicConfigResponse({
      POSTHOG_KEY: 'phc_test',
      OD_TELEMETRY_ENV: 'local_development',
    })).toEqual({
      enabled: false,
      env: 'local_development',
      key: null,
      host: null,
    });
  });

  it('does not construct a PostHog client or capture even when POSTHOG_KEY is set', async () => {
    posthogCapture.mockReset();
    const { PostHog } = await import('posthog-node');
    (PostHog as unknown as ReturnType<typeof vi.fn>).mockClear();
    const dataDir = await mkdtemp(path.join(tmpdir(), 'od-analytics-env-'));
    await writeFile(path.join(dataDir, 'app-config.json'), JSON.stringify({
      installationId: 'install-1',
      telemetry: { metrics: true },
    }));
    const { createAnalyticsService } = await import('../src/analytics.js');
    const analytics = createAnalyticsService({
      dataDir,
      env: {
        POSTHOG_KEY: 'phc_test',
        OD_TELEMETRY_ENV: 'local_development',
      },
    });

    analytics.capture({
      eventName: 'unit_event',
      appVersion: '1.2.3',
      context: {
        deviceId: 'device-1',
        sessionId: 'session-1',
        clientType: 'web',
        locale: 'en',
        requestId: null,
      },
      insertId: 'insert-1',
      properties: {},
    });
    await analytics.captureSafety({
      eventName: 'unit_safety',
      appVersion: '1.2.3',
      properties: {},
    });
    await analytics.shutdown();

    expect(PostHog).not.toHaveBeenCalled();
    expect(posthogCapture).not.toHaveBeenCalled();
  });
});
