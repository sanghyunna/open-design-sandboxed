// Pure, side-effect-free resolution of the updater-related environment
// overrides a packaged run should apply before desktop main reads them.
//
// Keeping this logic out of `index.ts` (the Electron entrypoint) makes the
// portable-disable invariant unit-testable without booting Electron or
// importing the desktop main process, and lets `index.ts` stay a thin
// orchestration shell: compute the overrides here, apply them there.

// Canonical updater env var names. These MUST stay in lockstep with
// `DESKTOP_UPDATE_ENV` in `apps/desktop/src/main/updater.ts` (the constant the
// desktop updater actually parses): `OD_UPDATE_METADATA_URL` at
// `DESKTOP_UPDATE_ENV.METADATA_URL` and `OD_UPDATE_ENABLED` at
// `DESKTOP_UPDATE_ENV.ENABLED`. We reference the literals rather than importing
// the constant because it is not exported from the `@open-design/desktop/main`
// package surface, and `apps/packaged` must not reach into another app's
// private `src/` (see apps/AGENTS.md sidecar-awareness / import boundaries).
export const UPDATE_METADATA_URL_ENV = "OD_UPDATE_METADATA_URL";
export const UPDATE_ENABLED_ENV = "OD_UPDATE_ENABLED";

function isEnvValueSet(value: string | undefined): boolean {
  return value != null && value.length > 0;
}

export type PackagedUpdaterEnvInput = {
  updateMetadataUrl: string | null;
  portable: boolean;
  env: NodeJS.ProcessEnv;
};

// Returns the updater env vars a packaged run should add, given the baked
// config and the current environment. Existing (user/launcher-set) values are
// never overwritten, so an explicit env always wins over both the baked
// metadata URL and the portable default.
//
// Portable invariant (Trap 2 in refactor_ideas.md §3.4): a portable run
// defaults the updater OFF. The updater is otherwise enabled by default for the
// packaged source, and on Windows it downloads the NSIS installer — accepting
// an update would convert a self-contained portable extraction into a
// `$LOCALAPPDATA\Programs` install with an HKCU uninstall key, silently
// de-portabilizing the user and splitting their data across two copies. An
// explicit `OD_UPDATE_ENABLED` set by the user still wins, so this only changes
// the default, never an opt-in.
export function resolvePackagedUpdaterEnv(input: PackagedUpdaterEnvInput): Record<string, string> {
  const overrides: Record<string, string> = {};

  const metadataUrl = input.updateMetadataUrl;
  if (metadataUrl != null && metadataUrl.length > 0 && !isEnvValueSet(input.env[UPDATE_METADATA_URL_ENV])) {
    overrides[UPDATE_METADATA_URL_ENV] = metadataUrl;
  }

  if (input.portable && !isEnvValueSet(input.env[UPDATE_ENABLED_ENV])) {
    overrides[UPDATE_ENABLED_ENV] = "0";
  }

  return overrides;
}
