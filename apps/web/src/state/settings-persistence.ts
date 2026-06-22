import { syncComposioConfigToDaemon } from './config';
import type { AppConfig } from '../types';

function normalizeSavedComposioConfig(config: AppConfig['composio']): AppConfig['composio'] {
  const apiKey = config?.apiKey?.trim() ?? '';
  if (apiKey) {
    return {
      ...config,
      apiKey: '',
      apiKeyConfigured: true,
      apiKeyTail: apiKey.slice(-4),
    };
  }
  return { ...(config ?? {}) };
}

export async function persistComposioConfigChange(
  current: AppConfig,
  composio: AppConfig['composio'],
  sync: (config: AppConfig['composio']) => Promise<boolean> = syncComposioConfigToDaemon,
): Promise<AppConfig> {
  const saved = await sync(composio);
  if (!saved) throw new Error('Composio config save failed');
  return {
    ...current,
    composio: normalizeSavedComposioConfig(composio),
  };
}

export function buildPersistedConfig(next: AppConfig, current: AppConfig): AppConfig {
  const stalePrivacySnapshot =
    current.privacyDecisionAt != null && next.privacyDecisionAt == null;
  return {
    ...next,
    onboardingCompleted: current.onboardingCompleted ? true : next.onboardingCompleted,
    ...(stalePrivacySnapshot
      ? {
          installationId: current.installationId,
          privacyDecisionAt: current.privacyDecisionAt,
          telemetry: current.telemetry,
        }
      : {}),
    composio: next.composio
      ? {
          apiKey: '',
          apiKeyConfigured: Boolean(next.composio.apiKeyConfigured),
          apiKeyTail: next.composio.apiKeyTail ?? '',
        }
      : next.composio,
  };
}

/**
 * True when `next` and `last` produce an identical persisted shape —
 * i.e. the only diffs between them are fields that buildPersistedConfig
 * intentionally strips before disk/daemon writes (the Composio API key
 * draft today; any future save-on-explicit-confirm secrets later).
 *
 * The autosave loop in Settings uses this to skip the "All changes
 * saved" indicator transition when the user has only typed an unsaved
 * secret. Without it, autosave completes a no-op write and flashes
 * "Saved" — misleading users into trusting that a sensitive key has
 * been persisted when in fact only the section-local "Save key"
 * gesture commits it.
 */
export function isAutosaveDraftOnlyChange(next: AppConfig, last: AppConfig): boolean {
  return (
    JSON.stringify(buildPersistedConfig(next, next))
    === JSON.stringify(buildPersistedConfig(last, last))
  );
}

export function resolveSettingsCloseConfig(
  rendered: AppConfig,
  latestPersisted: AppConfig,
): AppConfig {
  const base = latestPersisted === rendered ? rendered : latestPersisted;
  return base.onboardingCompleted ? base : { ...base, onboardingCompleted: true };
}
