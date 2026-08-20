import {
  READABLE_STUDIO_PLUGIN_SPEC_VERSION,
  UNSUPPORTED_OPEN_DESIGN_V1,
  PluginManifestSchema,
  type PluginManifest,
} from '@readable-studio/contracts';

export { UNSUPPORTED_OPEN_DESIGN_V1 };

export interface ManifestParseSuccess {
  ok: true;
  manifest: PluginManifest;
  warnings: string[];
}

export interface ManifestParseFailure {
  readonly ok: false;
  readonly code?: typeof UNSUPPORTED_OPEN_DESIGN_V1;
  readonly warnings: string[];
  readonly errors: string[];
}

export type ManifestParseResult = ManifestParseSuccess | ManifestParseFailure;

// Read raw `readable-studio.json` text into a typed PluginManifest. The Zod
// schema is permissive (passthrough), so unknown forward-compatible fields
// survive parse without complaint. Warnings carry adapter hints — e.g. a
// claude-plugin sidecar that declared an unmappable capability.
// @dsp func-65a68e18
export function parseManifest(raw: string): ManifestParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      warnings: [],
      errors: [`readable-studio.json is not valid JSON: ${(err as Error).message}`],
    };
  }
  return parseManifestObject(json);
}

// @dsp func-1c846dab
export function parseManifestObject(value: unknown): ManifestParseResult {
  if (isUnsupportedOpenDesignV1(value)) {
    return {
      ok: false,
      code: UNSUPPORTED_OPEN_DESIGN_V1,
      warnings: [],
      errors: [UNSUPPORTED_OPEN_DESIGN_V1],
    };
  }

  const result = PluginManifestSchema.safeParse(value);
  if (!result.success) {
    return {
      ok: false,
      warnings: [],
      errors: result.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
    };
  }
  return {
    ok: true,
    manifest: {
      specVersion: READABLE_STUDIO_PLUGIN_SPEC_VERSION,
      ...result.data,
    },
    warnings: [],
  };
}

export function isUnsupportedOpenDesignV1(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (Object.hasOwn(value, 'od')) return true;
  const schema = Reflect.get(value, '$schema');
  return typeof schema === 'string' && schema.includes('open-design.ai/schemas/');
}
