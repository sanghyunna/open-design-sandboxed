// RED tests for /api/agents threading enabledAgentIds through to detectAgents.
//
// The static-resource route is the only HTTP entry point for the agent
// picker. It must:
//
//   - Default to DEFAULT_ENABLED_AGENT_IDS (['codex', 'cursor-agent'])
//     when the saved app-config has no enabledAgentIds field.
//   - Honor the override when the user has saved a custom set.
//   - Pass that set straight through to detectAgents() so the daemon
//     does not silently fan out to every AGENT_DEF.
//
// We intercept detectAgents at its module boundary and inspect the
// options it received instead of running real probes.
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { isLocalSameOrigin } from '../../src/origin-validation.js';
import { writeAppConfig } from '../../src/app-config.js';

type FakeAgent = { id: string; available?: boolean };
type DetectAgentsFn = (
  envByAgent?: Record<string, Record<string, string>>,
  options?: { enabledAgentIds?: string[] },
) => Promise<FakeAgent[]>;
type DetectAgentsStreamFn = (
  envByAgent?: Record<string, Record<string, string>>,
  options?: { enabledAgentIds?: string[] },
) => AsyncGenerator<FakeAgent>;

const { detectAgentsMock, detectAgentsStreamMock } = vi.hoisted(() => ({
  detectAgentsMock: vi.fn<DetectAgentsFn>(async () => []),
  detectAgentsStreamMock: vi.fn<DetectAgentsStreamFn>(async function* () {
    // generator yields nothing by default
  }),
}));

vi.mock('../../src/agents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/agents.js')>();
  return {
    ...actual,
    detectAgents: detectAgentsMock,
    detectAgentsStream: detectAgentsStreamMock,
  };
});

import { registerStaticResourceRoutes } from '../../src/routes/static-resource.js';

describe('GET /api/agents respects enabledAgentIds', () => {
  let server: http.Server;
  let baseUrl: string;
  let tempRoot: string;
  let dataDir: string;

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'od-agents-route-'));
        dataDir = path.join(tempRoot, 'data');
        fs.mkdirSync(dataDir, { recursive: true });

        const app = express();
        app.use(express.json({ limit: '4mb' }));
        registerStaticResourceRoutes(app, {
          http: {
            createSseResponse: () => undefined,
            isLocalSameOrigin,
            requireLocalDaemonRequest: (_req: unknown, _res: unknown, next: () => void) => next(),
            resolvedPortRef: {
              get current() {
                const address = server.address();
                return typeof address === 'object' && address ? address.port : 0;
              },
            },
            sendApiError: (res: express.Response, status: number, code: string, message: string) =>
              res.status(status).json({ error: message, code }),
            sendLiveArtifactRouteError: () => undefined,
            sendMulterError: () => undefined,
          },
          paths: {
            ARTIFACTS_DIR: path.join(tempRoot, 'artifacts'),
            BUNDLED_PETS_DIR: path.join(tempRoot, 'pets'),
            DESIGN_SYSTEMS_DIR: path.join(tempRoot, 'design-systems'),
            DESIGN_TEMPLATES_DIR: path.join(tempRoot, 'design-templates'),
            OD_BIN: path.join(tempRoot, 'od'),
            PROJECT_ROOT: tempRoot,
            PROJECTS_DIR: path.join(tempRoot, 'projects'),
            PROMPT_TEMPLATES_DIR: path.join(tempRoot, 'prompt-templates'),
            RUNTIME_DATA_DIR: dataDir,
            RUNTIME_DATA_DIR_CANONICAL: dataDir,
            SKILLS_DIR: path.join(tempRoot, 'skills'),
            USER_DESIGN_SYSTEMS_DIR: path.join(tempRoot, 'user-design-systems'),
            USER_DESIGN_TEMPLATES_DIR: path.join(tempRoot, 'user-design-templates'),
            USER_SKILLS_DIR: path.join(tempRoot, 'user-skills'),
          },
          resources: {
            listAllDesignSystems: async () => [],
            listAllSkills: async () => [],
            listAllDesignTemplates: async () => [],
            listAllSkillLikeEntries: async () => [],
            mimeFor: () => 'application/octet-stream',
          },
        });

        server = app.listen(0, '127.0.0.1', () => {
          const addr = server.address() as { port: number };
          baseUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
      }),
  );

  afterAll(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          fs.rmSync(tempRoot, { recursive: true, force: true });
          resolve();
        });
      }),
  );

  beforeEach(() => {
    detectAgentsMock.mockClear();
    detectAgentsMock.mockResolvedValue([
      { id: 'codex', available: true },
      { id: 'cursor-agent', available: true },
    ]);
    // Reset config file between tests so the defaulted-vs-overridden
    // assertions don't leak state into one another.
    try {
      fs.rmSync(path.join(dataDir, 'app-config.json'), { force: true });
    } catch {}
  });

  it('defaults enabledAgentIds to ["codex","cursor-agent"] when config has none', async () => {
    const res = await fetch(`${baseUrl}/api/agents`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agents: Array<{ id: string }> };
    expect(Array.isArray(body.agents)).toBe(true);

    expect(detectAgentsMock).toHaveBeenCalledTimes(1);
    const callArgs = detectAgentsMock.mock.calls[0]!;
    const options = callArgs[1] as { enabledAgentIds?: string[] } | undefined;
    expect(options?.enabledAgentIds).toBeDefined();
    expect([...(options!.enabledAgentIds ?? [])].sort()).toEqual(
      ['codex', 'cursor-agent'].sort(),
    );
  });

  it('honors a saved enabledAgentIds override from app-config', async () => {
    await writeAppConfig(dataDir, { enabledAgentIds: ['codex'] });

    const res = await fetch(`${baseUrl}/api/agents`);
    expect(res.status).toBe(200);

    expect(detectAgentsMock).toHaveBeenCalledTimes(1);
    const options = detectAgentsMock.mock.calls[0]![1] as
      | { enabledAgentIds?: string[] }
      | undefined;
    expect(options?.enabledAgentIds).toEqual(['codex']);
  });

  it('normalizes "agent" alias from saved config to cursor-agent', async () => {
    // Older configs (and CLI users) may save 'agent' rather than the
    // canonical 'cursor-agent'. The route must hand the canonical id
    // to detectAgents.
    await writeAppConfig(dataDir, { enabledAgentIds: ['agent'] });

    const res = await fetch(`${baseUrl}/api/agents`);
    expect(res.status).toBe(200);

    const options = detectAgentsMock.mock.calls[0]![1] as
      | { enabledAgentIds?: string[] }
      | undefined;
    expect(options?.enabledAgentIds).toEqual(['cursor-agent']);
  });

  it('serves a static catalog at /api/agents/catalog without probing', async () => {
    const res = await fetch(`${baseUrl}/api/agents/catalog`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agents: Array<{ id: string; name: string }> };
    expect(Array.isArray(body.agents)).toBe(true);
    expect(body.agents.length).toBeGreaterThan(0);
    expect(body.agents.some((a) => a.id === 'codex')).toBe(true);
    expect(body.agents.some((a) => a.id === 'cursor-agent')).toBe(true);
    expect(body.agents.every((a) => typeof a.id === 'string' && typeof a.name === 'string')).toBe(true);
    expect(detectAgentsMock).not.toHaveBeenCalled();
    expect(detectAgentsStreamMock).not.toHaveBeenCalled();
  });
});
