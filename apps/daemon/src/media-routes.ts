import fs from 'node:fs';
import type { Express } from 'express';
import type { RouteDeps } from './server-context.js';
import { proxyDispatcherRequestInit } from './connectionTest.js';

export interface RegisterMediaRoutesDeps extends RouteDeps<'http' | 'paths' | 'appConfig' | 'orbit' | 'nativeDialogs' | 'research'> {}

export type LegacyMediaRouteGrantDecision =
  | { ok: true; grant: { projectId: string } | null }
  | {
      ok: false;
      code: string;
      details?: Record<string, unknown>;
      message: string;
      status: number;
    };

export function resolveLegacyMediaRouteGrant(input: {
  grant: { projectId: string } | null;
  projectId: string;
  requestProjectOverride: (projectId: string, tokenProjectId: string) => boolean;
  sandboxMode: boolean;
}): LegacyMediaRouteGrantDecision {
  if (
    input.sandboxMode &&
    input.grant &&
    input.requestProjectOverride(input.projectId, input.grant.projectId)
  ) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      details: { suppliedProjectId: input.projectId },
      message: 'projectId is derived from the tool token',
      status: 403,
    };
  }

  if (!input.grant && input.sandboxMode) {
    return {
      ok: false,
      code: 'TOOL_TOKEN_MISSING',
      message: 'tool token is required for media generation in sandbox mode',
      status: 401,
    };
  }

  return { ok: true, grant: input.grant };
}

export function registerMediaRoutes(app: Express, ctx: RegisterMediaRoutesDeps) {
  const { isLocalSameOrigin, resolvedPortRef } = ctx.http;
  const { PROJECT_ROOT, RUNTIME_DATA_DIR } = ctx.paths;
  const { readAppConfig, writeAppConfig } = ctx.appConfig;
  const { orbitService } = ctx.orbit;
  const { openNativeFolderDialog } = ctx.nativeDialogs;
  const { searchResearch, ResearchError } = ctx.research;
  const getResolvedPort = () => resolvedPortRef.current;

  app.get('/api/app-config', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const config = await readAppConfig(RUNTIME_DATA_DIR);
      res.json({ config });
    } catch (err: any) {
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.put('/api/app-config', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const config = await writeAppConfig(RUNTIME_DATA_DIR, req.body);
      orbitService.configure(config.orbit);
      res.json({ config });
    } catch (err: any) {
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  // Lightweight existence probe for a single directory, used by the composer
  // to flag a working directory in red the moment its folder is gone (the
  // composer re-checks on focus / picker-open, so deletions reflect live).
  app.post('/api/dir-exists', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    const dir = typeof req.body?.path === 'string' ? req.body.path : '';
    let exists = false;
    if (dir) {
      try {
        exists = fs.statSync(dir).isDirectory();
      } catch {
        exists = false;
      }
    }
    res.json({ exists });
  });

  // Recent working directories, pruned to those that still exist on disk. A
  // folder the user deleted (or an external drive that's gone) drops out of
  // the list here and the pruned list is persisted back, so the picker's
  // "recent folders" never offers a path that no longer resolves.
  app.get('/api/recent-dirs', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const config = await readAppConfig(RUNTIME_DATA_DIR);
      const recents = Array.isArray(config.recentLinkedDirs)
        ? config.recentLinkedDirs
        : [];
      const existing = recents.filter((dir: string) => {
        try {
          return fs.statSync(dir).isDirectory();
        } catch {
          return false;
        }
      });
      if (existing.length !== recents.length) {
        await writeAppConfig(RUNTIME_DATA_DIR, { recentLinkedDirs: existing });
      }
      /** @type {import('@open-design/contracts').RecentLinkedDirsResponse} */
      const body = { dirs: existing };
      res.json(body);
    } catch (err: any) {
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.get('/api/orbit/status', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      res.json(await orbitService.status());
    } catch (err: any) {
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.post('/api/orbit/run', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const locale = typeof req.body?.locale === 'string' ? req.body.locale : null;
      res.json(await orbitService.start('manual', { locale }));
    } catch (err: any) {
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  // Native OS folder picker dialog. Returns { path: string | null }.
  app.post('/api/dialog/open-folder', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({ error: 'cross-origin request rejected' });
    }
    try {
      const selected = await openNativeFolderDialog();
      res.json({ path: selected });
    } catch (err: any) {
      res
        .status(500)
        .json({ error: String(err && err.message ? err.message : err) });
    }
  });

  app.post('/api/research/search', async (req, res) => {
    if (!isLocalSameOrigin(req, getResolvedPort())) {
      return res.status(403).json({
        error:
          'cross-origin request rejected: research search is restricted to the local UI / CLI',
      });
    }

    try {
      const proxyDispatcher = proxyDispatcherRequestInit(process.env);
      try {
        const result = await searchResearch({
          projectRoot: PROJECT_ROOT,
          query: req.body?.query,
          maxSources:
            typeof req.body?.maxSources === 'number'
              ? req.body.maxSources
              : undefined,
          providers: Array.isArray(req.body?.providers)
            ? req.body.providers
            : undefined,
          requestInit: proxyDispatcher.requestInit,
        });
        res.json(result);
      } finally {
        await proxyDispatcher.close();
      }
    } catch (err: any) {
      if (err instanceof ResearchError) {
        return res.status(err.status).json({
          error: { code: err.code, message: err.message },
        });
      }
      res.status(500).json({
        error: {
          code: 'RESEARCH_FAILED',
          message: String(err && err.message ? err.message : err),
        },
      });
    }
  });

  // Multi-file upload that the chat composer uses for paste/drop/picker.
  // Files land flat in the project folder; the response carries the same
  // metadata as listFiles so the client can stage them as ChatAttachments
  // without a separate refetch.

}
