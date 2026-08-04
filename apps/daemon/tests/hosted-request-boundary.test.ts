import express from 'express';
import { readdir } from 'node:fs/promises';
import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createHostedRequestBoundary,
  createHostedRequestBodyGuard,
  getHostedAuthContext,
  HOSTED_ROUTE_CHARACTERIZATION,
  isHostedRouteAllowed,
  type HostedIdentityResolver,
} from '../src/hosted-request-boundary.js';
import { startServer } from '../src/server.js';

const context = {
  userKey: 'identity:user-a',
  storageKey: 'user-a',
  requestId: 'request-1',
  displayName: 'User A',
} as const;

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

async function listen(
  resolver?: HostedIdentityResolver,
): Promise<{ baseUrl: string; resolverRequests: string[] }> {
  const resolverRequests: string[] = [];
  const app = express();
  const effectiveResolver: HostedIdentityResolver = resolver
    ? async (request, metadata) => {
        resolverRequests.push(metadata.path);
        return resolver(request, metadata);
      }
    : (_request, metadata) => {
        resolverRequests.push(metadata.path);
        return context;
      };
  app.use(
    createHostedRequestBoundary({
      resolveIdentity: effectiveResolver,
    }),
  );
  app.use(express.json());
  app.use(createHostedRequestBodyGuard());
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/projects/:id', (req, res) => {
    res.json({ projectId: req.params.id, auth: getHostedAuthContext(req) });
  });

  const server = await new Promise<http.Server>((resolve) => {
    const next = app.listen(0, '127.0.0.1', () => resolve(next));
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind');
  return { baseUrl: `http://127.0.0.1:${address.port}`, resolverRequests };
}

describe('hosted request boundary', () => {
  it('keeps probes open but fails closed when no identity adapter exists', async () => {
    const app = express();
    app.use(createHostedRequestBoundary({}));
    app.get('/api/health', (_req, res) => res.json({ ok: true }));
    app.get('/api/projects/:id', (_req, res) => res.json({ ok: true }));
    const server = await new Promise<http.Server>((resolve) => {
      const next = app.listen(0, '127.0.0.1', () => resolve(next));
    });
    servers.push(server);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    await expect(fetch(`${baseUrl}/api/health`)).resolves.toMatchObject({ status: 200 });
    await expect(fetch(`${baseUrl}/api/projects/a`)).resolves.toMatchObject({ status: 503 });
  });

  it('attaches immutable server identity to an allowed request', async () => {
    const { baseUrl, resolverRequests } = await listen(() => context);
    const response = await fetch(`${baseUrl}/api/projects/a`);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      projectId: string;
      auth: { userKey: string; storageKey: string; displayName: string; requestId: string };
    };
    expect(body).toMatchObject({
      projectId: 'a',
      auth: {
        userKey: context.userKey,
        storageKey: context.storageKey,
        displayName: context.displayName,
      },
    });
    expect(body.auth.requestId).not.toBe(context.requestId);
    expect(body.auth.requestId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(resolverRequests).toEqual(['/api/projects/a']);
  });

  it('rejects unknown routes and wrong methods before route handlers run', async () => {
    const { baseUrl } = await listen(() => context);
    expect((await fetch(`${baseUrl}/api/not-allowed`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/projects/a`, { method: 'POST' })).status).toBe(404);
  });

  it.each([
    ['query', '/api/projects/a?userKey=attacker', undefined],
    ['header', '/api/projects/a', { 'x-user-key': 'attacker' }],
  ])('rejects client-selected ownership from %s', async (_kind, path, headers) => {
    const { baseUrl } = await listen(() => context);
    const response = await fetch(
      `${baseUrl}${path}`,
      headers === undefined ? undefined : { headers },
    );
    expect(response.status).toBe(400);
  });

  it('rejects client-selected ownership in a JSON body', async () => {
    const { baseUrl } = await listen(() => context);
    const response = await fetch(`${baseUrl}/api/projects/a`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ownerId: 'attacker' }),
    });
    expect(response.status).toBe(400);
  });

  it('rejects encoded, slash, and backslash path variants', async () => {
    const { baseUrl } = await listen(() => context);
    for (const suffix of ['%2fsecret', '%5csecret', '%2e%2e%2fsecret']) {
      expect((await fetch(`${baseUrl}/api/projects/a${suffix}`)).status).toBe(404);
    }
    expect(isHostedRouteAllowed('GET', '/api/projects/..')).toBe(false);
    expect(isHostedRouteAllowed('GET', '/api/projects/.')).toBe(false);
  });

  it('fails closed when a resolver returns an invalid context', async () => {
    const { baseUrl } = await listen(() => ({ ...context, storageKey: '../escape' }));
    expect((await fetch(`${baseUrl}/api/projects/a`)).status).toBe(500);
  });

  it.each(['Alice', 'CON', 'NUL', 'COM1'])(
    'rejects non-canonical or Windows-reserved storage key %s',
    async (storageKey) => {
      const { baseUrl } = await listen(() => ({ ...context, storageKey }));
      expect((await fetch(`${baseUrl}/api/projects/a`)).status).toBe(500);
    },
  );

  it('fails closed for deeply nested and wide ownership payloads', async () => {
    const { baseUrl } = await listen(() => context);
    const nested = { metadata: { audit: { ownerId: 'attacker' } } };
    const wide = {
      ...Object.fromEntries(Array.from({ length: 128 }, (_, index) => [`field-${index}`, index])),
      userKey: 'attacker',
    };
    for (const body of [nested, wide]) {
      const response = await fetch(`${baseUrl}/api/projects/a`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
    const wideArray = Array.from({ length: 10_001 }, () => 0);
    const wideArrayResponse = await fetch(`${baseUrl}/api/projects/a`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ values: wideArray }),
    });
    expect(wideArrayResponse.status).toBe(400);
  });

  it('allows ordinary primitive and array fields', async () => {
    const { baseUrl } = await listen(() => context);
    for (const body of [
      { title: 'hello', count: 1, enabled: true, empty: null },
      { attachments: ['a.png', 'b.png'], tags: [] },
    ]) {
      const response = await fetch(`${baseUrl}/api/projects/a`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(404);
    }
  });

  it.each(HOSTED_ROUTE_CHARACTERIZATION.allowed)(
    'keeps characterized hosted route allowed: $method $path',
    ({ method, path }) => {
      expect(isHostedRouteAllowed(method, path)).toBe(true);
    },
  );

  it.each(HOSTED_ROUTE_CHARACTERIZATION.excluded)(
    'keeps characterized local route excluded: $method $path',
    ({ method, path }) => {
      expect(isHostedRouteAllowed(method, path)).toBe(false);
    },
  );

  it('installs the boundary in the real daemon and leaves local startup unchanged', async () => {
    const close = async (started: {
      server: http.Server;
      shutdown?: () => Promise<void> | void;
    }) => {
      await started.shutdown?.();
      await new Promise<void>((resolve) => started.server.close(() => resolve()));
    };

    const hosted = (await startServer({
      port: 0,
      returnServer: true,
      hostedRequestBoundary: {},
    })) as { url: string; server: http.Server; shutdown?: () => Promise<void> | void };
    try {
      expect((await fetch(`${hosted.url}/api/health`)).status).toBe(200);
      expect((await fetch(`${hosted.url}/api/projects`)).status).toBe(503);
      expect(
        (
          await fetch(`${hosted.url}/api/projects`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{',
          })
        ).status,
      ).toBe(503);
      expect(
        (
          await fetch(`${hosted.url}/api/not-allowed`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{',
          })
        ).status,
      ).toBe(404);
    } finally {
      await close(hosted);
    }

    const hostedWithIdentity = (await startServer({
      port: 0,
      returnServer: true,
      hostedRequestBoundary: {
        resolveIdentity: () => ({
          userKey: 'identity:multipart',
          storageKey: 'multipart',
        }),
      },
    })) as { url: string; server: http.Server; shutdown?: () => Promise<void> | void };
    try {
      const multipart = new FormData();
      const filename = `hosted-owner-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
      multipart.set('ownerId', 'attacker');
      multipart.set('file', new Blob(['should be removed'], { type: 'text/plain' }), filename);
      const multipartResponse = await fetch(`${hostedWithIdentity.url}/api/projects/a/files`, {
        method: 'POST',
        body: multipart,
      });
      expect(multipartResponse.status).toBe(400);
      const multipartBody = await multipartResponse.json() as { error: { code: string } };
      expect(multipartBody.error.code).toBe('HOSTED_OWNER_FIELD_FORBIDDEN');
      const uploadDir = path.join(os.tmpdir(), 'od-uploads');
      let leftovers: string[] = [];
      for (let attempt = 0; attempt < 20; attempt += 1) {
        leftovers = (await readdir(uploadDir)).filter((entry) => entry.endsWith(`-${filename}`));
        if (leftovers.length === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(leftovers).toEqual([]);
    } finally {
      await close(hostedWithIdentity);
    }

    const local = (await startServer({
      port: 0,
      returnServer: true,
    })) as { url: string; server: http.Server; shutdown?: () => Promise<void> | void };
    try {
      expect((await fetch(`${local.url}/api/projects`)).status).toBe(200);
    } finally {
      await close(local);
    }
  });

  it('replays the representative hosted trace twice with route-level assertions', async () => {
    const started = (await startServer({
      port: 0,
      returnServer: true,
      hostedRequestBoundary: {
        resolveIdentity: () => ({
          userKey: 'identity:trace',
          storageKey: 'trace',
          displayName: 'Trace',
        }),
      },
    })) as { url: string; server: http.Server; shutdown?: () => Promise<void> | void };
    type TraceCase = {
      method: string;
      path: string;
      body?: unknown;
      headers?: Record<string, string>;
      status: number;
      routeCode?: string;
      legacyError?: string;
      boundaryDenied?: boolean;
    };
    const cases: TraceCase[] = [
      // Boot and catalog requests.
      { method: 'GET', path: '/api/health', status: 200 },
      { method: 'GET', path: '/api/projects', status: 200 },
      { method: 'GET', path: '/api/agents/catalog', status: 200 },
      { method: 'GET', path: '/api/skills', status: 200 },
      { method: 'GET', path: '/api/design-systems', status: 200 },
      // Project/files workflow: invalid input is deliberate so no state is created.
      { method: 'POST', path: '/api/projects', body: {}, status: 400, routeCode: 'BAD_REQUEST' },
      { method: 'GET', path: '/api/projects/missing/files', status: 200 },
      { method: 'GET', path: '/api/projects/missing/files/index.html', status: 404, routeCode: 'FILE_NOT_FOUND' },
      { method: 'GET', path: '/api/projects/missing/preview-url', status: 404, routeCode: 'PROJECT_NOT_FOUND' },
      { method: 'GET', path: '/api/projects/missing/files/index.html/preview', status: 404, routeCode: 'FILE_NOT_FOUND' },
      { method: 'GET', path: '/api/projects/missing/archive', status: 404, routeCode: 'FILE_NOT_FOUND' },
      { method: 'GET', path: '/api/projects/missing/export/manifest', status: 404, routeCode: 'PROJECT_NOT_FOUND' },
      // Prompt, stream, reconnect, cancel, and session status/resume paths.
      { method: 'POST', path: '/api/runs', body: { toolBundle: 'invalid' }, status: 400, routeCode: 'BAD_REQUEST' },
      { method: 'POST', path: '/api/chat', body: { toolBundle: 'invalid' }, status: 400, routeCode: 'BAD_REQUEST' },
      { method: 'GET', path: '/api/runs/missing', status: 404, routeCode: 'NOT_FOUND' },
      { method: 'GET', path: '/api/runs/missing/events', headers: { 'Last-Event-ID': '42' }, status: 404, routeCode: 'NOT_FOUND' },
      { method: 'GET', path: '/api/runs/missing/agui', headers: { 'Last-Event-ID': '42' }, status: 404, routeCode: 'NOT_FOUND' },
      { method: 'POST', path: '/api/runs/missing/cancel', status: 404, routeCode: 'NOT_FOUND' },
      // Tool and artifact traffic.
      { method: 'POST', path: '/api/tools/design-systems/read', body: {}, status: 401, routeCode: 'TOOL_TOKEN_MISSING' },
      { method: 'POST', path: '/api/artifacts/lint', body: {}, status: 400, legacyError: 'html required' },
      { method: 'POST', path: '/api/artifacts/save', body: {}, status: 400, legacyError: 'html required' },
      // Local-only route classes must remain denied by the hosted boundary.
      { method: 'GET', path: '/api/agents', status: 404, boundaryDenied: true },
      { method: 'GET', path: '/api/app-config', status: 404, boundaryDenied: true },
      { method: 'GET', path: '/api/projects/a/raw/index.html', status: 404, boundaryDenied: true },
      { method: 'GET', path: '/api/projects/a/export/index.html', status: 404, boundaryDenied: true },
      { method: 'GET', path: '/api/projects/a/terminals', status: 404, boundaryDenied: true },
      { method: 'POST', path: '/api/dialog/open-folder', status: 404, boundaryDenied: true },
      { method: 'GET', path: '/api/mcp/servers', status: 404, boundaryDenied: true },
      { method: 'POST', path: '/api/mcp/oauth/start', body: {}, status: 404, boundaryDenied: true },
      { method: 'GET', path: '/api/plugins', status: 404, boundaryDenied: true },
      { method: 'POST', path: '/api/plugins/install', body: {}, status: 404, boundaryDenied: true },
      { method: 'POST', path: '/api/projects/a/upload', body: {}, status: 404, boundaryDenied: true },
      { method: 'POST', path: '/api/projects/a/working-dir', body: {}, status: 404, boundaryDenied: true },
      { method: 'GET', path: '/api/project-locations', status: 404, boundaryDenied: true },
      { method: 'POST', path: '/api/proxy/openai/stream', body: {}, status: 404, boundaryDenied: true },
      { method: 'POST', path: '/api/system/open-external', body: {}, status: 404, boundaryDenied: true },
      { method: 'GET', path: '/api/system/fonts', status: 404, boundaryDenied: true },
      { method: 'POST', path: '/api/research/search', body: {}, status: 404, boundaryDenied: true },
      { method: 'POST', path: '/api/agents/claude/oauth-launch', status: 404, boundaryDenied: true },
    ];

    const replayTrace = async () => {
      const results: Array<{ status: number; code?: string; legacyError?: string }> = [];
      for (const item of cases) {
        const response = await fetch(`${started.url}${item.path}`, {
          method: item.method,
          headers: {
            ...(item.body === undefined ? {} : { 'content-type': 'application/json' }),
            ...(item.headers ?? {}),
          },
          ...(item.body === undefined ? {} : { body: JSON.stringify(item.body) }),
        });
        const text = await response.text();
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          body = undefined;
        }
        const record = body && typeof body === 'object' ? body as Record<string, unknown> : undefined;
        const error = record?.error && typeof record.error === 'object'
          ? record.error as Record<string, unknown>
          : undefined;
        const code = typeof error?.code === 'string' ? error.code : undefined;
        const legacyError = typeof record?.error === 'string' ? record.error : undefined;
        results.push({ status: response.status, ...(code ? { code } : {}), ...(legacyError ? { legacyError } : {}) });
        expect(response.status).toBe(item.status);
        if (item.boundaryDenied) {
          expect(code).toBe('HOSTED_ROUTE_NOT_ALLOWED');
        } else {
          expect(code).not.toBe('HOSTED_ROUTE_NOT_ALLOWED');
        }
        if (item.routeCode !== undefined) expect(code).toBe(item.routeCode);
        if (item.legacyError !== undefined) expect(legacyError).toBe(item.legacyError);
      }
      return results;
    };
    try {
      const first = await replayTrace();
      const second = await replayTrace();
      expect(second).toEqual(first);
    } finally {
      await started.shutdown?.();
      await new Promise<void>((resolve) => started.server.close(() => resolve()));
    }
  });
});
