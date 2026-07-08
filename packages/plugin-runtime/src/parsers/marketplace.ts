import { MarketplaceManifestSchema, type MarketplaceManifest } from '@open-design/contracts';

export interface MarketplaceParseSuccess {
  ok: true;
  manifest: MarketplaceManifest;
}

export interface MarketplaceParseFailure {
  ok: false;
  errors: string[];
}

export type MarketplaceParseResult = MarketplaceParseSuccess | MarketplaceParseFailure;

// @dsp func-8c1b17c7
export function parseMarketplace(raw: string): MarketplaceParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return { ok: false, errors: [`open-design-marketplace.json is not valid JSON: ${(err as Error).message}`] };
  }
  const result = MarketplaceManifestSchema.safeParse(json);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`),
    };
  }
  return { ok: true, manifest: result.data };
}
