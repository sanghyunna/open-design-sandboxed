'use client';

import dynamic from 'next/dynamic';

import { installErrorHandlers } from '../../src/analytics/error-tracking';
import { installWebObservability } from '../../src/observability/install';

function isHostedComposition(): boolean {
  return typeof document !== 'undefined'
    && document.documentElement.getAttribute('data-od-composition') === 'hosted';
}

// The server-rendered marker exists before this module and any local app
// storage access. Hosted boot intentionally does not install the local
// analytics/observability stack.
if (typeof window !== 'undefined' && !isHostedComposition()) {
  installErrorHandlers();
  installWebObservability();
}

// The product is a fully client-driven SPA — every component reads
// localStorage, window.location, etc. — so we opt out of static-time
// rendering for the entire tree. This keeps `next build --output export`
// from trying to evaluate browser-only code while still emitting a real
// shell HTML the daemon can serve as the SPA fallback.
const LocalApp = dynamic(() => import('../../src/App').then((m) => m.App), {
  ssr: false,
  loading: () => <div className="od-loading-shell">Loading Open Design…</div>,
});

const HostedApp = dynamic(() => import('../../src/HostedApp').then((m) => m.HostedApp), {
  ssr: false,
  loading: () => <div className="od-loading-shell">Loading Open Design…</div>,
});

export function ClientApp() {
  return isHostedComposition() ? <HostedApp /> : <LocalApp />;
}
