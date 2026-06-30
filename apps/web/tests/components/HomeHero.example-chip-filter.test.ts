// Home example-prompt chip filtering - pure derivation contract.

import { describe, expect, it } from 'vitest';
import type { InstalledPluginRecord } from '@open-design/contracts';
import {
  homeHeroExamplePluginsForChip,
  pluginMatchesExampleChip,
} from '../../src/components/HomeHero';

interface MakeArgs {
  id: string;
  title?: string;
  tags?: string[];
  mode?: string;
  surface?: string;
  scenario?: string;
}

function make(args: MakeArgs): InstalledPluginRecord {
  return {
    id: args.id,
    title: args.title ?? args.id,
    version: '0.1.0',
    sourceKind: 'bundled',
    source: '/tmp',
    trust: 'bundled',
    capabilitiesGranted: [],
    manifest: {
      name: args.id,
      version: '0.1.0',
      title: args.title ?? args.id,
      ...(args.tags ? { tags: args.tags } : {}),
      od: {
        kind: 'scenario',
        ...(args.mode ? { mode: args.mode } : {}),
        ...(args.surface ? { surface: args.surface } : {}),
        ...(args.scenario ? { scenario: args.scenario } : {}),
        useCase: { query: `use ${args.id}` },
      },
    },
    fsPath: '/tmp',
    installedAt: 0,
    updatedAt: 0,
  } as unknown as InstalledPluginRecord;
}

const liveDashboard = make({
  id: 'example-live-dashboard',
  title: 'Live Dashboard',
  tags: ['example', 'first-party', 'live-artifact', 'dashboard'],
  mode: 'prototype',
  surface: 'web',
  scenario: 'live',
});

const plainPrototype = make({
  id: 'example-web-prototype',
  title: 'Web Prototype',
  tags: ['example', 'first-party', 'prototype'],
  mode: 'prototype',
  surface: 'web',
  scenario: 'prototype',
});

describe('pluginMatchesExampleChip - live artifact chip', () => {
  it('keeps live artifact templates under the live artifact chip', () => {
    expect(pluginMatchesExampleChip(liveDashboard, 'live-artifact')).toBe(true);
  });

  it('does not place plain prototypes under the live artifact chip', () => {
    expect(pluginMatchesExampleChip(plainPrototype, 'live-artifact')).toBe(false);
  });
});

describe('homeHeroExamplePluginsForChip - live artifact chip', () => {
  it('shows live artifact examples without pulling in plain prototypes', () => {
    const ids = homeHeroExamplePluginsForChip('live-artifact', [plainPrototype, liveDashboard], 'en').map((p) => p.id);
    expect(ids).toEqual(['example-live-dashboard']);
  });
});
