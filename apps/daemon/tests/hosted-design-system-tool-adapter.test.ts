import { describe, expect, it, vi } from 'vitest';

import {
  HOSTED_DESIGN_SYSTEM_CONTENT_MAX_BYTES,
  HOSTED_DESIGN_SYSTEM_GRANT_MAX_TTL_MS,
  HOSTED_DESIGN_SYSTEM_READ_ENDPOINT,
  HostedDesignSystemToolAdapterError,
  createHostedDesignSystemToolAdapter,
  type HostedDesignSystemToolAuthInput,
  type HostedDesignSystemToolBinding,
} from '../src/hosted-design-system-tool-adapter.js';

const binding: HostedDesignSystemToolBinding = {
  userKey: 'user-a',
  runId: 'run-a',
  projectId: 'project-a',
  endpoint: HOSTED_DESIGN_SYSTEM_READ_ENDPOINT,
  generation: 1,
  designSystemId: 'calm-web',
};

function fixture() {
  const adapter = createHostedDesignSystemToolAdapter({
    catalogue: [{
      id: 'calm-web',
      files: [
        { path: 'DESIGN.md', content: '# Calm\n' },
        { path: 'preview/colors.html', content: '<h1>Colors</h1>' },
      ],
    }],
  });
  const grant = adapter.mintGrant(binding);
  const auth: HostedDesignSystemToolAuthInput = {
    token: grant.token,
    cookiePresent: false,
    csrfPresent: false,
    origin: null,
    binding,
  };
  return { adapter, auth, grant };
}

describe('hosted design-system tool adapter', () => {
  it('rejects browser and unauthenticated calls before parsing their body', async () => {
    const { adapter, auth } = fixture();
    try {
      const invalidAuth: HostedDesignSystemToolAuthInput[] = [
        { ...auth, token: null },
        { ...auth, cookiePresent: true },
        { ...auth, csrfPresent: true },
        { ...auth, origin: 'https://hosted.example' },
        { ...auth, binding: null },
      ];

      for (const candidate of invalidAuth) {
        const readBody = vi.fn(() => ({ path: 'DESIGN.md' }));
        await expect(adapter.read({ auth: candidate, readBody })).rejects.toBeInstanceOf(
          HostedDesignSystemToolAdapterError,
        );
        expect(readBody).not.toHaveBeenCalled();
      }
    } finally {
      adapter.dispose();
    }
  });

  it('binds copied grants to user, run, project, endpoint, generation, and catalogue', async () => {
    const { adapter, auth, grant } = fixture();
    try {
      const response = await adapter.read({
        auth,
        readBody: () => ({ path: 'DESIGN.md', designSystemId: 'calm-web' }),
      });
      expect(response).toEqual({ content: '# Calm\n' });
      expect(Object.keys(response)).toEqual(['content']);
      expect(JSON.stringify(response)).not.toContain(grant.token);
      expect(JSON.stringify(response)).not.toContain('DESIGN.md');

      const mismatches: HostedDesignSystemToolBinding[] = [
        { ...binding, userKey: 'user-b' },
        { ...binding, runId: 'run-b' },
        { ...binding, projectId: 'project-b' },
        { ...binding, endpoint: '/api/projects/:id/files' as never },
        { ...binding, generation: 2 },
        { ...binding, designSystemId: 'other-brand' },
      ];
      for (const mismatch of mismatches) {
        const readBody = vi.fn(() => ({ path: 'DESIGN.md' }));
        await expect(adapter.read({
          auth: { ...auth, binding: mismatch },
          readBody,
        })).rejects.toMatchObject({ code: 'FORBIDDEN' });
        expect(readBody).not.toHaveBeenCalled();
      }
    } finally {
      adapter.dispose();
    }
  });

  it('accepts only the exact V1 body and manifest-declared grant paths', async () => {
    const { adapter, auth } = fixture();
    try {
      for (const body of [
        null,
        {},
        { path: '' },
        { path: '../DESIGN.md' },
        { path: 'DESIGN.md', owner: 'user-a' },
        { path: 'DESIGN.md', token: 'copied-token' },
        { path: 'DESIGN.md', grant: {} },
        { path: 'DESIGN.md', root: 'C:\\private' },
        { path: 'DESIGN.md', designSystemId: '' },
        { path: 'x'.repeat(1_025) },
      ]) {
        await expect(adapter.read({ auth, readBody: () => body })).rejects.toMatchObject({
          code: 'BAD_REQUEST',
        });
      }

      await expect(adapter.read({
        auth,
        readBody: () => ({ path: 'DESIGN.md', designSystemId: 'other-brand' }),
      })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(adapter.read({
        auth,
        readBody: () => ({ path: 'preview/not-in-manifest.html' }),
      })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      adapter.dispose();
    }
  });

  it('caps grant lifetime at 31 minutes and supports explicit revocation', async () => {
    let now = 1_000;
    const adapter = createHostedDesignSystemToolAdapter({
      catalogue: [{ id: 'calm-web', files: [{ path: 'DESIGN.md', content: '# Calm\n' }] }],
      now: () => now,
    });
    try {
      expect(() => adapter.mintGrant(binding, {
        ttlMs: HOSTED_DESIGN_SYSTEM_GRANT_MAX_TTL_MS + 1,
      })).toThrowError(expect.objectContaining({ code: 'INTERNAL_ERROR' }));

      const expiring = adapter.mintGrant(binding, { ttlMs: 1_000 });
      expect(expiring.expiresAt).toBe(new Date(2_000).toISOString());
      now = 2_000;
      const expiredBody = vi.fn(() => ({ path: 'DESIGN.md' }));
      await expect(adapter.read({
        auth: {
          token: expiring.token,
          cookiePresent: false,
          csrfPresent: false,
          origin: null,
          binding,
        },
        readBody: expiredBody,
      })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      expect(expiredBody).not.toHaveBeenCalled();

      const revoked = adapter.mintGrant(binding);
      expect(adapter.revoke(revoked.token)).toBe(true);
      expect(adapter.revoke(revoked.token)).toBe(false);
      const revokedBody = vi.fn(() => ({ path: 'DESIGN.md' }));
      await expect(adapter.read({
        auth: {
          token: revoked.token,
          cookiePresent: false,
          csrfPresent: false,
          origin: null,
          binding,
        },
        readBody: revokedBody,
      })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      expect(revokedBody).not.toHaveBeenCalled();
    } finally {
      adapter.dispose();
    }
  });

  it('snapshots a bounded immutable manifest catalogue', async () => {
    const file = { path: 'DESIGN.md', content: '# Original\n' };
    const catalogue = [{ id: 'calm-web', files: [file] }];
    const adapter = createHostedDesignSystemToolAdapter({ catalogue });
    const grant = adapter.mintGrant(binding);
    file.path = 'private.txt';
    file.content = 'secret';
    catalogue[0]!.files.push({ path: 'late.txt', content: 'late' });
    try {
      const response = await adapter.read({
        auth: {
          token: grant.token,
          cookiePresent: false,
          csrfPresent: false,
          origin: null,
          binding,
        },
        readBody: () => ({ path: 'DESIGN.md' }),
      });
      expect(response).toEqual({ content: '# Original\n' });
      await expect(adapter.read({
        auth: {
          token: grant.token,
          cookiePresent: false,
          csrfPresent: false,
          origin: null,
          binding,
        },
        readBody: () => ({ path: 'late.txt' }),
      })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    } finally {
      adapter.dispose();
    }

    expect(() => createHostedDesignSystemToolAdapter({
      catalogue: [{
        id: 'calm-web',
        files: [{ path: 'DESIGN.md', content: 'x'.repeat(HOSTED_DESIGN_SYSTEM_CONTENT_MAX_BYTES + 1) }],
      }],
    })).toThrowError(expect.objectContaining({ code: 'INTERNAL_ERROR' }));
  });
});
