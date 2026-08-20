import { describe, expect, it } from 'vitest';
import {
  UNSUPPORTED_OPEN_DESIGN_V1,
  parseManifest,
  parseManifestObject,
} from '../src/parsers/manifest';
import { parseMarketplace } from '../src/parsers/marketplace';
import { parseFrontmatter } from '../src/parsers/frontmatter';

describe('parseManifest', () => {
  it('accepts the minimal sidecar shape', () => {
    const result = parseManifest(JSON.stringify({
      name: 'sample-plugin',
      version: '1.0.0',
    }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.name).toBe('sample-plugin');
      expect(result.manifest.version).toBe('1.0.0');
    }
  });

  it('rejects an invalid name', () => {
    const result = parseManifest(JSON.stringify({
      name: 'Sample Plugin!',
      version: '1.0.0',
    }));
    expect(result.ok).toBe(false);
  });

  it('preserves unknown forward-compatible fields', () => {
    const result = parseManifest(JSON.stringify({
      name: 'sample-plugin',
      version: '1.0.0',
      futureField: { hello: 'world' },
      readable: { futureReadableField: true },
    }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Reflect.get(result.manifest, 'futureField')).toEqual({ hello: 'world' });
      expect(Reflect.get(result.manifest.readable ?? {}, 'futureReadableField')).toBe(true);
    }
  });

  it('accepts localized use-case queries in the readable namespace', () => {
    const result = parseManifest(JSON.stringify({
      name: 'sample-plugin',
      version: '1.0.0',
      readable: {
        useCase: {
          query: {
            en: 'Make a brief.',
            'zh-CN': '写一份简报。',
          },
        },
      },
    }));

    expect(result.ok).toBe(true);
  });

  it('rejects an Open Design v1 metadata object with the documented code', () => {
    const result = parseManifestObject({
      name: 'legacy-plugin',
      version: '1.0.0',
      od: { mode: 'prototype' },
    });

    expect(result).toMatchObject({ ok: false, code: UNSUPPORTED_OPEN_DESIGN_V1 });
  });

  it('rejects an Open Design v1 schema URL with the documented code', () => {
    const result = parseManifest(JSON.stringify({
      $schema: 'https://open-design.ai/schemas/plugin.v1.json',
      name: 'legacy-plugin',
      version: '1.0.0',
    }));

    expect(result).toMatchObject({ ok: false, code: UNSUPPORTED_OPEN_DESIGN_V1 });
  });
});

describe('parseMarketplace', () => {
  it('accepts a tiny catalog', () => {
    const result = parseMarketplace(JSON.stringify({
      specVersion: '1.0.0',
      name: 'readable-studio-official',
      version: '1.0.0',
      plugins: [{ name: 'make-a-deck', source: 'github:open-design/plugins/make-a-deck', version: '0.1.0' }],
    }));
    expect(result.ok).toBe(true);
  });

  it('rejects when catalog version is missing', () => {
    const result = parseMarketplace(JSON.stringify({
      name: 'no-version',
      plugins: [{ name: 'make-a-deck', source: 'github:open-design/plugins/make-a-deck', version: '0.1.0' }],
    }));
    expect(result.ok).toBe(false);
  });

  it('rejects when plugin entry version is missing', () => {
    const result = parseMarketplace(JSON.stringify({
      name: 'missing-plugin-version',
      version: '1.0.0',
      plugins: [{ name: 'make-a-deck', source: 'github:open-design/plugins/make-a-deck' }],
    }));
    expect(result.ok).toBe(false);
  });

  it('rejects when plugins is missing', () => {
    const result = parseMarketplace(JSON.stringify({ name: 'no-plugins', version: '1.0.0' }));
    expect(result.ok).toBe(false);
  });
});

describe('parseFrontmatter', () => {
  it('parses a single-line description', () => {
    const { data, body } = parseFrontmatter('---\nname: foo\ndescription: hello\n---\nbody');
    expect(data['name']).toBe('foo');
    expect(data['description']).toBe('hello');
    expect(body).toBe('body');
  });

  it('parses block-literal descriptions', () => {
    const src = '---\nname: foo\ndescription: |\n  line 1\n  line 2\n---\nbody';
    const { data } = parseFrontmatter(src);
    expect(data['description']).toBe('line 1\nline 2');
  });

  it('returns empty data when no frontmatter delimiter is present', () => {
    const { data, body } = parseFrontmatter('# heading');
    expect(Object.keys(data)).toHaveLength(0);
    expect(body).toBe('# heading');
  });
});
