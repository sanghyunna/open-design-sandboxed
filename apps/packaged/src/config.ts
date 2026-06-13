import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { SIDECAR_DEFAULTS, normalizeNamespace } from "@open-design/sidecar-proto";

// `electron` is loaded lazily so this module can also be imported from the
// headless entry, which runs in a plain Node process without the electron
// dependency on disk. Top-level `import { app } from "electron"` would crash
// headless at module-load with ERR_MODULE_NOT_FOUND.
async function loadElectronApp() {
  const electron = await import("electron");
  return electron.app;
}

export const PACKAGED_CONFIG_PATH_ENV = "OD_PACKAGED_CONFIG_PATH";
export const PACKAGED_NAMESPACE_ENV = "OD_PACKAGED_NAMESPACE";
export const PACKAGED_WEB_OUTPUT_MODE_OVERRIDE_ENV = "OD_PACKAGED_ALLOW_WEB_OUTPUT_MODE_OVERRIDE";
export const PACKAGED_WEB_STANDALONE_ROOT_ENV = "OD_WEB_STANDALONE_ROOT";
export const PACKAGED_WEB_OUTPUT_MODE_ENV = "OD_WEB_OUTPUT_MODE";

export type PackagedWebOutputMode = "server" | "standalone";
export type PackagedAmrProfile = "prod" | "test" | "local";

export type RawPackagedConfig = {
  amrProfile?: string;
  appVersion?: string;
  daemonCliEntryRelative?: string;
  daemonSidecarEntryRelative?: string;
  namespace?: string;
  namespaceBaseRoot?: string;
  nodeCommandRelative?: string;
  // True only in the portable Windows zip artifact. tools/pack injects this
  // flag into the zip's copy of open-design-config.json AFTER the shared
  // win-unpacked tree is built (see tools/pack/src/win/zip.ts), so it never
  // leaks into the NSIS installer that ships from the same tree. When set, the
  // runtime keeps all data beside the extracted exe and disables the updater
  // (see readPackagedConfig and apps/packaged/src/index.ts).
  portable?: boolean;
  resourceRoot?: string;
  // Baked by tools/pack from OPEN_DESIGN_TELEMETRY_RELAY_URL and forwarded to
  // the daemon at runtime; Langfuse credentials never ship in packaged config.
  telemetryRelayUrl?: string;
  updateMetadataUrl?: string;
  // PostHog product-analytics ingest key, baked by tools/pack from
  // process.env.POSTHOG_KEY at packaging time. Forwarded to the daemon
  // sidecar's spawn env as POSTHOG_KEY. `phc_` keys are public ingest
  // tokens (write-only event capture); embedding them in the bundle is
  // the PostHog-recommended pattern. The integration short-circuits when
  // either this is absent or the user has declined Privacy → metrics.
  posthogKey?: string;
  posthogHost?: string;
  webSidecarEntryRelative?: string;
  webStandaloneRoot?: string;
  webOutputMode?: string;
};

export type PackagedConfig = {
  amrProfile: PackagedAmrProfile | null;
  appVersion: string | null;
  daemonCliEntry: string | null;
  daemonSidecarEntry: string | null;
  namespace: string;
  namespaceBaseRoot: string;
  nodeCommand: string | null;
  portable: boolean;
  resourceRoot: string;
  telemetryRelayUrl: string | null;
  updateMetadataUrl: string | null;
  posthogKey: string | null;
  posthogHost: string | null;
  webSidecarEntry: string | null;
  webStandaloneRoot: string | null;
  webOutputMode: PackagedWebOutputMode;
};

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath: string): Promise<RawPackagedConfig | null> {
  if (!(await pathExists(filePath))) return null;
  return JSON.parse(await readFile(filePath, "utf8")) as RawPackagedConfig;
}

function resolveDefaultConfigPath(): string {
  return join(process.resourcesPath, "open-design-config.json");
}

async function readRawPackagedConfig(): Promise<RawPackagedConfig> {
  const explicit = process.env[PACKAGED_CONFIG_PATH_ENV];
  if (explicit != null && explicit.length > 0) {
    const config = await readJsonIfExists(resolve(explicit));
    if (config == null) throw new Error(`packaged config not found at ${explicit}`);
    return config;
  }

  const electronApp = await loadElectronApp();
  return (
    (await readJsonIfExists(resolveDefaultConfigPath())) ??
    (await readJsonIfExists(join(electronApp.getAppPath(), "open-design-config.json"))) ??
    {}
  );
}

function resolveOptionalPath(value: string | undefined): string | undefined {
  return value == null || value.length === 0 ? undefined : resolve(value);
}

// Config DTOs use null for optional scalar values consumed by runtime options;
// optional paths use undefined so callers can distinguish "no path" from a resolved path string.
function cleanOptionalString(value: string | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function resolvePackagedWebOutputMode(value: string | undefined): PackagedWebOutputMode {
  if (value == null || value.length === 0) return "server";
  if (value === "server" || value === "standalone") return value;
  throw new Error(`unsupported packaged web output mode: ${value}`);
}

function resolvePackagedAmrProfile(value: string | undefined): PackagedAmrProfile | null {
  const cleaned = cleanOptionalString(value);
  if (cleaned == null) return null;
  if (cleaned === "prod" || cleaned === "test" || cleaned === "local") return cleaned;
  throw new Error(`unsupported packaged AMR profile: ${value}`);
}

function isTruthyEnv(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

// The portable signal is a baked JSON boolean (tools/pack writes a literal
// `true`); only an explicit `true` enables portable mode. Anything else —
// absent, `false`, or a malformed value from a hand-edited config — resolves
// to the non-portable default so a partial/garbage config can never silently
// relocate a user's data tree.
function resolvePackagedPortable(value: boolean | undefined): boolean {
  return value === true;
}

function resolvePackagedWebStandaloneRoot(
  webOutputMode: PackagedWebOutputMode,
  value: string | undefined,
): string | null {
  const configured = resolveOptionalPath(value);
  if (configured != null) return configured;
  if (webOutputMode !== "standalone") return null;
  return join(process.resourcesPath, "open-design-web-standalone");
}

async function resolvePackagedRelativeEntry(value: string | undefined): Promise<string | null> {
  const cleaned = cleanOptionalString(value);
  if (cleaned == null) return null;
  const entry = join(process.resourcesPath, cleaned);
  if (!(await pathExists(entry))) {
    throw new Error(`configured packaged entry not found at ${entry}`);
  }
  return entry;
}

export async function readPackagedConfig(): Promise<PackagedConfig> {
  const raw = await readRawPackagedConfig();
  const namespace = normalizeNamespace(
    process.env[PACKAGED_NAMESPACE_ENV] ?? raw.namespace ?? SIDECAR_DEFAULTS.namespace,
  );
  const electronApp = await loadElectronApp();
  const portable = resolvePackagedPortable(raw.portable);
  // Portable invariant: a portable extraction keeps ALL runtime data beside the
  // extracted exe (`<exeDir>/OpenDesignData/namespaces`) so nothing lands in
  // %APPDATA% or the registry. In the win-unpacked/zip layout
  // `dirname(process.execPath)` IS the extraction root (resources/ sits beside
  // the exe), and everything else — daemon dataRoot, Chromium profile, logs,
  // updates — derives from this single root (apps/packaged/src/paths.ts), so
  // branching only the fallback here relocates the whole tree.
  //
  // An explicit `namespaceBaseRoot` ALWAYS wins, including in portable mode:
  // portable only changes the *fallback*. tools/pack omits namespaceBaseRoot
  // from portable artifacts precisely so this branch is reached, but a caller
  // that bakes an explicit root (e.g. a relocated install) keeps it.
  const namespaceBaseRoot =
    resolveOptionalPath(raw.namespaceBaseRoot) ??
    (portable
      ? join(dirname(process.execPath), "OpenDesignData", "namespaces")
      : join(electronApp.getPath("userData"), "namespaces"));
  const resourceRoot = resolveOptionalPath(raw.resourceRoot) ?? join(process.resourcesPath, "open-design");
  const relativeNodeCommand =
    raw.nodeCommandRelative == null || raw.nodeCommandRelative.length === 0
      ? join("open-design", "bin", "node")
      : raw.nodeCommandRelative;
  const nodeCommandCandidate = join(process.resourcesPath, relativeNodeCommand);
  const nodeCommand = (await pathExists(nodeCommandCandidate)) ? nodeCommandCandidate : null;
  const allowWebOutputModeOverride = isTruthyEnv(process.env[PACKAGED_WEB_OUTPUT_MODE_OVERRIDE_ENV]);
  const webOutputMode = resolvePackagedWebOutputMode(
    allowWebOutputModeOverride
      ? process.env[PACKAGED_WEB_OUTPUT_MODE_ENV] ?? raw.webOutputMode
      : raw.webOutputMode,
  );
  const webStandaloneRoot = resolvePackagedWebStandaloneRoot(
    webOutputMode,
    allowWebOutputModeOverride
      ? process.env[PACKAGED_WEB_STANDALONE_ROOT_ENV] ?? raw.webStandaloneRoot
      : raw.webStandaloneRoot,
  );
  const daemonCliEntry = await resolvePackagedRelativeEntry(raw.daemonCliEntryRelative);
  const daemonSidecarEntry = await resolvePackagedRelativeEntry(raw.daemonSidecarEntryRelative);
  const webSidecarEntry = await resolvePackagedRelativeEntry(raw.webSidecarEntryRelative);

  return {
    amrProfile: resolvePackagedAmrProfile(raw.amrProfile),
    appVersion: cleanOptionalString(raw.appVersion),
    daemonCliEntry,
    daemonSidecarEntry,
    namespace,
    namespaceBaseRoot,
    nodeCommand,
    portable,
    resourceRoot,
    telemetryRelayUrl: cleanOptionalString(raw.telemetryRelayUrl),
    updateMetadataUrl: cleanOptionalString(raw.updateMetadataUrl),
    posthogKey: cleanOptionalString(raw.posthogKey),
    posthogHost: cleanOptionalString(raw.posthogHost),
    webSidecarEntry,
    webStandaloneRoot,
    webOutputMode,
  };
}
