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
// This is a private fork: it must NEVER auto-update from the upstream release
// feed. The updater defaults ON for the upstream packaged source, and on Windows
// it checks `https://releases.open-design.ai/<channel>/latest` and downloads the
// published release. Previously the updater was forced off ONLY for portable
// runs, so a non-portable (win-unpacked / NSIS) run kept it ON and pulled an
// incompatible UPSTREAM release (e.g. 0.10.1), "promoting" a broken payload into
// the launcher state and bricking startup (splash → hang → crash). So force the
// updater OFF for EVERY packaged build of this fork — portable and installed
// alike. An explicit user-set `OD_UPDATE_ENABLED` still wins for deliberate
// internal testing. `input.portable` is retained on the input for callers but is
// no longer a precondition for disabling.
export function resolvePackagedUpdaterEnv(input: PackagedUpdaterEnvInput): Record<string, string> {
  const overrides: Record<string, string> = {};

  const metadataUrl = input.updateMetadataUrl;
  if (metadataUrl != null && metadataUrl.length > 0 && !isEnvValueSet(input.env[UPDATE_METADATA_URL_ENV])) {
    overrides[UPDATE_METADATA_URL_ENV] = metadataUrl;
  }

  if (!isEnvValueSet(input.env[UPDATE_ENABLED_ENV])) {
    overrides[UPDATE_ENABLED_ENV] = "0";
  }

  return overrides;
}
