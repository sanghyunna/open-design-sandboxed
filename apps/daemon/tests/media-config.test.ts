import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveProviderConfig } from '../src/media-config.js';

const TEST_NANOBANANA_BASE_URL = 'https://nano-banana-gateway.example.test';

const OPENAI_ENV_KEYS = [
  'OD_OPENAI_API_KEY',
  'OPENAI_API_KEY',
  'AZURE_API_KEY',
  'AZURE_OPENAI_API_KEY',
];

describe('media-config OpenAI auth-file fallback', () => {
  let homeDir: string;
  let projectRoot: string;
  const originalHome = process.env.HOME;
  const originalEnv = Object.fromEntries(
    OPENAI_ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  const originalMediaConfigDir = process.env.OD_MEDIA_CONFIG_DIR;
  const originalDataDir = process.env.OD_DATA_DIR;
  const originalSandboxMode = process.env.OD_SANDBOX_MODE;
  let homedirSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    homeDir = await mkdtemp(path.join(tmpdir(), 'od-media-home-'));
    projectRoot = await mkdtemp(path.join(tmpdir(), 'od-media-project-'));
    process.env.HOME = homeDir;
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
    for (const key of OPENAI_ENV_KEYS) {
      delete process.env[key];
    }
    delete process.env.OD_MEDIA_CONFIG_DIR;
    delete process.env.OD_DATA_DIR;
    delete process.env.OD_SANDBOX_MODE;
  });

  afterEach(async () => {
    if (originalHome == null) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    for (const key of OPENAI_ENV_KEYS) {
      if (originalEnv[key] == null) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
    if (originalMediaConfigDir == null) {
      delete process.env.OD_MEDIA_CONFIG_DIR;
    } else {
      process.env.OD_MEDIA_CONFIG_DIR = originalMediaConfigDir;
    }
    if (originalDataDir == null) {
      delete process.env.OD_DATA_DIR;
    } else {
      process.env.OD_DATA_DIR = originalDataDir;
    }
    if (originalSandboxMode == null) {
      delete process.env.OD_SANDBOX_MODE;
    } else {
      process.env.OD_SANDBOX_MODE = originalSandboxMode;
    }
    homedirSpy.mockRestore();
    await rm(homeDir, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function writeHomeJson(relPath: string, data: unknown) {
    const file = path.join(homeDir, relPath);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(data), 'utf8');
  }

  async function writeStoredMediaConfig(data: unknown) {
    const file = path.join(projectRoot, '.od', 'media-config.json');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(data), 'utf8');
  }

  it('ignores Hermes openai-codex OAuth for media generation', async () => {
    await writeHomeJson('.hermes/auth.json', {
      providers: {
        'openai-codex': {
          tokens: { access_token: 'hermes-oauth-token' },
        },
      },
    });

    const resolved = await resolveProviderConfig(projectRoot, 'openai');

    expect(resolved.apiKey).toBe('');
  });

  it('ignores Codex OAuth tokens for media generation', async () => {
    await writeHomeJson('.codex/auth.json', {
      tokens: { access_token: 'codex-oauth-token' },
    });

    const resolved = await resolveProviderConfig(projectRoot, 'openai');

    expect(resolved.apiKey).toBe('');
  });

  it('does not read host OpenAI auth files in sandbox mode', async () => {
    process.env.OD_SANDBOX_MODE = '1';
    await writeHomeJson('.hermes/auth.json', {
      providers: {
        'openai-codex': {
          tokens: { access_token: 'hermes-oauth-token' },
        },
      },
    });
    await writeHomeJson('.codex/auth.json', {
      tokens: { access_token: 'codex-oauth-token' },
      OPENAI_API_KEY: 'host-codex-api-key',
    });

    const resolved = await resolveProviderConfig(projectRoot, 'openai');

    expect(resolved.apiKey).toBe('');
  });

  it('uses explicit OPENAI_API_KEY from Codex auth files', async () => {
    await writeHomeJson('.codex/auth.json', {
      tokens: { access_token: 'codex-oauth-token' },
      OPENAI_API_KEY: 'codex-api-key',
    });

    const resolved = await resolveProviderConfig(projectRoot, 'openai');

    expect(resolved.apiKey).toBe('codex-api-key');
  });

  it('keeps stored provider config ahead of auth-file fallbacks', async () => {
    await writeHomeJson('.hermes/auth.json', {
      providers: {
        'openai-codex': {
          tokens: { access_token: 'hermes-oauth-token' },
        },
      },
    });
    await writeStoredMediaConfig({
      providers: {
        openai: {
          apiKey: 'stored-openai-key',
          baseUrl: 'https://example.test/v1',
        },
      },
    });

    const resolved = await resolveProviderConfig(projectRoot, 'openai');

    expect(resolved).toEqual({
      apiKey: 'stored-openai-key',
      baseUrl: 'https://example.test/v1',
    });
  });

  it('resolves Nano Banana env and stored model overrides', async () => {
    process.env.OD_NANOBANANA_API_KEY = 'env-nano-key';
    await writeStoredMediaConfig({
      providers: {
        nanobanana: {
          apiKey: 'stored-nano-key',
          baseUrl: TEST_NANOBANANA_BASE_URL,
          model: 'gemini-3.1-flash-image-preview-custom',
        },
      },
    });

    const resolved = await resolveProviderConfig(projectRoot, 'nanobanana');

    expect(resolved).toEqual({
      apiKey: 'env-nano-key',
      baseUrl: TEST_NANOBANANA_BASE_URL,
      model: 'gemini-3.1-flash-image-preview-custom',
    });

    delete process.env.OD_NANOBANANA_API_KEY;
  });

  describe('OD_MEDIA_CONFIG_DIR / OD_DATA_DIR storage routing', () => {
    let overrideRoot: string;
    let originalMediaConfigDir: string | undefined;
    let originalDataDir: string | undefined;

    beforeEach(async () => {
      overrideRoot = await mkdtemp(path.join(tmpdir(), 'od-media-override-'));
      originalMediaConfigDir = process.env.OD_MEDIA_CONFIG_DIR;
      originalDataDir = process.env.OD_DATA_DIR;
      delete process.env.OD_MEDIA_CONFIG_DIR;
      delete process.env.OD_DATA_DIR;
    });

    afterEach(async () => {
      if (originalMediaConfigDir == null) {
        delete process.env.OD_MEDIA_CONFIG_DIR;
      } else {
        process.env.OD_MEDIA_CONFIG_DIR = originalMediaConfigDir;
      }
      if (originalDataDir == null) {
        delete process.env.OD_DATA_DIR;
      } else {
        process.env.OD_DATA_DIR = originalDataDir;
      }
      await rm(overrideRoot, { recursive: true, force: true });
    });

    async function writeProvidersAt(dir: string, data: unknown) {
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, 'media-config.json'),
        JSON.stringify(data),
        'utf8',
      );
    }

    it('reads media-config.json from an absolute OD_MEDIA_CONFIG_DIR', async () => {
      process.env.OD_MEDIA_CONFIG_DIR = overrideRoot;
      await writeProvidersAt(overrideRoot, {
        providers: {
          openai: {
            apiKey: 'absolute-key',
            baseUrl: 'https://absolute.test/v1',
          },
        },
      });

      const resolved = await resolveProviderConfig(projectRoot, 'openai');
      expect(resolved).toEqual({
        apiKey: 'absolute-key',
        baseUrl: 'https://absolute.test/v1',
      });
    });

    it('expands a leading ~/ against the user home directory', async () => {
      // Per-test HOME points at a tmpdir (set by outer beforeEach), so the
      // expansion lands somewhere safe to write.
      const subdir = '.od-test';
      process.env.OD_MEDIA_CONFIG_DIR = `~/${subdir}`;
      const expandedDir = path.join(homeDir, subdir);
      await writeProvidersAt(expandedDir, {
        providers: {
          openai: {
            apiKey: 'tilde-key',
            baseUrl: 'https://tilde.test/v1',
          },
        },
      });

      const resolved = await resolveProviderConfig(projectRoot, 'openai');
      expect(resolved).toEqual({
        apiKey: 'tilde-key',
        baseUrl: 'https://tilde.test/v1',
      });
    });

    it('resolves a relative override against projectRoot, not process.cwd', async () => {
      // process.cwd() during tests is typically the workspace root, which
      // is unrelated to the per-test projectRoot. A relative override must
      // land inside projectRoot, mirroring how resolveDataDir() in
      // server.ts anchors OD_DATA_DIR.
      const relative = 'config/media';
      process.env.OD_MEDIA_CONFIG_DIR = relative;
      const anchoredDir = path.join(projectRoot, relative);
      await writeProvidersAt(anchoredDir, {
        providers: {
          openai: {
            apiKey: 'relative-key',
            baseUrl: 'https://relative.test/v1',
          },
        },
      });

      const resolved = await resolveProviderConfig(projectRoot, 'openai');
      expect(resolved).toEqual({
        apiKey: 'relative-key',
        baseUrl: 'https://relative.test/v1',
      });
    });

    it('falls back to OD_DATA_DIR when OD_MEDIA_CONFIG_DIR is unset', async () => {
      // Packaged daemon (apps/packaged/src/sidecars.ts) and the
      // Home Manager / NixOS modules already set OD_DATA_DIR for the
      // rest of the daemon's runtime state. media-config should
      // co-locate there without needing a second env var.
      process.env.OD_DATA_DIR = overrideRoot;
      await writeProvidersAt(overrideRoot, {
        providers: {
          openai: {
            apiKey: 'datadir-key',
            baseUrl: 'https://datadir.test/v1',
          },
        },
      });

      const resolved = await resolveProviderConfig(projectRoot, 'openai');
      expect(resolved).toEqual({
        apiKey: 'datadir-key',
        baseUrl: 'https://datadir.test/v1',
      });
    });

    it('OD_MEDIA_CONFIG_DIR takes precedence over OD_DATA_DIR', async () => {
      const dataDir = await mkdtemp(path.join(tmpdir(), 'od-media-data-'));
      try {
        process.env.OD_DATA_DIR = dataDir;
        process.env.OD_MEDIA_CONFIG_DIR = overrideRoot;
        // Two competing files; only the OD_MEDIA_CONFIG_DIR one should
        // be read.
        await writeProvidersAt(dataDir, {
          providers: {
            openai: { apiKey: 'data-key', baseUrl: 'https://data/v1' },
          },
        });
        await writeProvidersAt(overrideRoot, {
          providers: {
            openai: { apiKey: 'media-key', baseUrl: 'https://media/v1' },
          },
        });

        const resolved = await resolveProviderConfig(projectRoot, 'openai');
        expect(resolved).toEqual({
          apiKey: 'media-key',
          baseUrl: 'https://media/v1',
        });
      } finally {
        await rm(dataDir, { recursive: true, force: true });
      }
    });

    // Round 3 review feedback on PR #530.
    // resolveOverrideDir shares expandHomePrefix with resolveDataDir, so
    // OD_DATA_DIR=$HOME/.open-design (and ${HOME}/.open-design) routes
    // both daemon runtime data AND media credentials to the same expanded
    // path. Without this, media-config.json was written under
    // <projectRoot>/$HOME/.open-design and stored provider keys appeared
    // missing on the next read.
    it('expands $HOME/... in OD_DATA_DIR fallback so media-config co-locates with daemon data', async () => {
      const subdir = '.od-test-home';
      process.env.OD_DATA_DIR = `$HOME/${subdir}`;
      const expandedDir = path.join(homeDir, subdir);
      await writeProvidersAt(expandedDir, {
        providers: {
          openai: {
            apiKey: 'home-key',
            baseUrl: 'https://home.test/v1',
          },
        },
      });

      const resolved = await resolveProviderConfig(projectRoot, 'openai');
      expect(resolved).toEqual({
        apiKey: 'home-key',
        baseUrl: 'https://home.test/v1',
      });
    });

    it('expands ${HOME}/... in OD_DATA_DIR fallback', async () => {
      const subdir = '.od-test-braced';
      process.env.OD_DATA_DIR = `\${HOME}/${subdir}`;
      const expandedDir = path.join(homeDir, subdir);
      await writeProvidersAt(expandedDir, {
        providers: {
          openai: {
            apiKey: 'braced-key',
            baseUrl: 'https://braced.test/v1',
          },
        },
      });

      const resolved = await resolveProviderConfig(projectRoot, 'openai');
      expect(resolved).toEqual({
        apiKey: 'braced-key',
        baseUrl: 'https://braced.test/v1',
      });
    });

    it('expands $HOME/... in OD_MEDIA_CONFIG_DIR (explicit override path)', async () => {
      const subdir = '.od-media-home';
      process.env.OD_MEDIA_CONFIG_DIR = `$HOME/${subdir}`;
      const expandedDir = path.join(homeDir, subdir);
      await writeProvidersAt(expandedDir, {
        providers: {
          openai: {
            apiKey: 'media-home-key',
            baseUrl: 'https://media-home.test/v1',
          },
        },
      });

      const resolved = await resolveProviderConfig(projectRoot, 'openai');
      expect(resolved).toEqual({
        apiKey: 'media-home-key',
        baseUrl: 'https://media-home.test/v1',
      });
    });
  });
});

const GROK_ENV_KEYS = ['OD_GROK_API_KEY', 'XAI_API_KEY'];

describe('media-config Grok / xAI OAuth fallback', () => {
  let homeDir: string;
  let projectRoot: string;
  const originalHome = process.env.HOME;
  const originalEnv = Object.fromEntries(
    GROK_ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  const originalMediaConfigDir = process.env.OD_MEDIA_CONFIG_DIR;
  const originalDataDir = process.env.OD_DATA_DIR;
  let homedirSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    homeDir = await mkdtemp(path.join(tmpdir(), 'od-media-grok-home-'));
    projectRoot = await mkdtemp(path.join(tmpdir(), 'od-media-grok-project-'));
    process.env.HOME = homeDir;
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
    for (const key of GROK_ENV_KEYS) {
      delete process.env[key];
    }
    delete process.env.OD_MEDIA_CONFIG_DIR;
    delete process.env.OD_DATA_DIR;
  });

  afterEach(async () => {
    if (originalHome == null) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    for (const key of GROK_ENV_KEYS) {
      if (originalEnv[key] == null) {
        delete process.env[key];
      } else {
        process.env[key] = originalEnv[key];
      }
    }
    if (originalMediaConfigDir == null) {
      delete process.env.OD_MEDIA_CONFIG_DIR;
    } else {
      process.env.OD_MEDIA_CONFIG_DIR = originalMediaConfigDir;
    }
    if (originalDataDir == null) {
      delete process.env.OD_DATA_DIR;
    } else {
      process.env.OD_DATA_DIR = originalDataDir;
    }
    homedirSpy.mockRestore();
    await rm(homeDir, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function writeHomeJson(relPath: string, data: unknown) {
    const file = path.join(homeDir, relPath);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(data), 'utf8');
  }

  async function writeOdXaiTokens(token: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
  }) {
    const file = path.join(projectRoot, '.od', 'xai-tokens.json');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({
        token: {
          accessToken: token.accessToken,
          tokenType: 'Bearer',
          savedAt: Date.now(),
          ...(token.refreshToken ? { refreshToken: token.refreshToken } : {}),
          ...(token.expiresAt !== undefined
            ? { expiresAt: token.expiresAt }
            : {}),
        },
      }),
      'utf8',
    );
  }

  async function writeStoredMediaConfig(data: unknown) {
    const file = path.join(projectRoot, '.od', 'media-config.json');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(data), 'utf8');
  }

  it('uses OD-native xai-tokens.json when one is stored', async () => {
    await writeOdXaiTokens({
      accessToken: 'od-bearer-1',
      expiresAt: Date.now() + 3_600_000,
    });

    const resolved = await resolveProviderConfig(projectRoot, 'grok');

    expect(resolved.apiKey).toBe('od-bearer-1');
  });

  it('borrows the Hermes-side xai-oauth token when OD has no native creds', async () => {
    await writeHomeJson('.hermes/auth.json', {
      providers: {
        'xai-oauth': {
          tokens: { access_token: 'hermes-xai-bearer' },
        },
      },
    });

    const resolved = await resolveProviderConfig(projectRoot, 'grok');

    expect(resolved.apiKey).toBe('hermes-xai-bearer');
  });

  it('prefers OD-native xai-tokens over Hermes borrowing', async () => {
    await writeOdXaiTokens({
      accessToken: 'od-bearer-2',
      expiresAt: Date.now() + 3_600_000,
    });
    await writeHomeJson('.hermes/auth.json', {
      providers: {
        'xai-oauth': {
          tokens: { access_token: 'hermes-xai-bearer' },
        },
      },
    });

    const resolved = await resolveProviderConfig(projectRoot, 'grok');
    expect(resolved.apiKey).toBe('od-bearer-2');
  });

  it('keeps env keys ahead of OAuth fallbacks', async () => {
    process.env.XAI_API_KEY = 'env-xai-key';
    await writeOdXaiTokens({
      accessToken: 'od-bearer-3',
      expiresAt: Date.now() + 3_600_000,
    });

    const resolved = await resolveProviderConfig(projectRoot, 'grok');

    expect(resolved.apiKey).toBe('env-xai-key');
  });

  it('keeps stored provider key ahead of OAuth fallbacks', async () => {
    await writeStoredMediaConfig({
      providers: {
        grok: { apiKey: 'stored-grok-key', baseUrl: 'https://api.x.ai/v1' },
      },
    });
    await writeOdXaiTokens({
      accessToken: 'od-bearer-4',
      expiresAt: Date.now() + 3_600_000,
    });

    const resolved = await resolveProviderConfig(projectRoot, 'grok');
    expect(resolved.apiKey).toBe('stored-grok-key');
  });

  it('returns empty when no env, no stored key, and no OAuth source exists', async () => {
    const resolved = await resolveProviderConfig(projectRoot, 'grok');

    expect(resolved.apiKey).toBe('');
  });

  it('skips an OD-native token within the expiry skew when no refresh_token is stored', async () => {
    // expiresAt within the 120s skew window → treated as expired by
    // resolveXAIBearer. Without a refresh_token it can't recover, so
    // the resolver falls through to other sources (none here).
    await writeOdXaiTokens({
      accessToken: 'od-bearer-expired',
      expiresAt: Date.now() + 30_000,
    });

    const resolved = await resolveProviderConfig(projectRoot, 'grok');
    expect(resolved.apiKey).toBe('');
  });
});

