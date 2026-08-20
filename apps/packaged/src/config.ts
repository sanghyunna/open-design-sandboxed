import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  SIDECAR_DEFAULTS,
  normalizeNamespace,
  normalizeRuntimeDescriptor,
  type RuntimeDescriptor,
} from "@readable-studio/sidecar-proto";

// `electron` is loaded lazily so this module can also be imported from the
// headless entry, which runs in a plain Node process without the electron
// dependency on disk. Top-level `import { app } from "electron"` would crash
// headless at module-load with ERR_MODULE_NOT_FOUND.
async function loadElectronApp() {
  const electron = await import("electron");
  return electron.app;
}

// @dsp func-79b9d4e0
export const PACKAGED_CONFIG_PATH_ENV = "OD_PACKAGED_CONFIG_PATH";
// @dsp func-83b35750
export const PACKAGED_NAMESPACE_ENV = "OD_PACKAGED_NAMESPACE";
// @dsp func-d42e2a3f
export const PACKAGED_WEB_OUTPUT_MODE_OVERRIDE_ENV = "OD_PACKAGED_ALLOW_WEB_OUTPUT_MODE_OVERRIDE";
// @dsp func-f515152c
export const PACKAGED_WEB_STANDALONE_ROOT_ENV = "OD_WEB_STANDALONE_ROOT";
// @dsp func-857c9413
export const PACKAGED_WEB_OUTPUT_MODE_ENV = "OD_WEB_OUTPUT_MODE";

export type PackagedWebOutputMode = "server" | "standalone";
export type PackagedAmrProfile = "prod" | "test" | "local";

// @dsp func-53f198c4
export function resolveDefaultPackagedNodeCommandRelativePath(
  platform: NodeJS.Platform = process.platform,
): string {
  return `readable-studio/bin/${platform === "win32" ? "node.exe" : "node"}`;
}

export type RawPackagedConfig = {
  amrProfile?: string;
  appVersion?: string;
  arch?: string;
  artifact?: string;
  daemonCliEntryRelative?: string;
  daemonSidecarEntryRelative?: string;
  descriptor?: unknown;
  namespace?: string;
  namespaceBaseRoot?: string;
  nodeCommandRelative?: string;
  // True in the sole Windows portable ZIP artifact. tools/pack writes this
  // directly into readable-studio-config.json before assembling the extracted
  // runtime so all runtime data stays beside the executable.
  portable?: boolean;
  platform?: string;
  resourceRoot?: string;
  webSidecarEntryRelative?: string;
  webStandaloneRoot?: string;
  webOutputMode?: string;
};

export type PackagedConfig = {
  amrProfile: PackagedAmrProfile | null;
  appVersion: string | null;
  arch: "x64" | null;
  artifact: "portable-zip" | null;
  daemonCliEntry: string | null;
  daemonSidecarEntry: string | null;
  descriptor: RuntimeDescriptor;
  namespace: string;
  namespaceBaseRoot: string;
  nodeCommand: string | null;
  portable: boolean;
  platform: "win32" | null;
  resourceRoot: string;
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
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("root must be an object");
    }
    return parsed as RawPackagedConfig;
  } catch (error) {
    throw new Error(
      `packaged config at ${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function resolveDefaultConfigPath(): string {
  return join(process.resourcesPath, "readable-studio-config.json");
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
    (await readJsonIfExists(join(electronApp.getAppPath(), "readable-studio-config.json"))) ??
    {}
  );
}

function resolveOptionalPath(value: unknown, field: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`packaged config ${field} must be a non-empty path string`);
  }
  return resolve(value);
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

function resolvePortableTarget<T extends string>(
  portable: boolean,
  field: string,
  value: string | undefined,
  expected: T,
): T | null {
  if (!portable && value == null) return null;
  if (value !== expected) {
    throw new Error(`portable config ${field} must be ${JSON.stringify(expected)}`);
  }
  return expected;
}

function resolvePackagedWebStandaloneRoot(
  webOutputMode: PackagedWebOutputMode,
  value: string | undefined,
): string | null {
  const configured = resolveOptionalPath(value, "webStandaloneRoot");
  if (configured != null) return configured;
  if (webOutputMode !== "standalone") return null;
  return join(process.resourcesPath, "readable-studio-web-standalone");
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

// @dsp func-6b11f489
export async function readPackagedConfig(): Promise<PackagedConfig> {
  const raw = await readRawPackagedConfig();
  const descriptor = normalizeRuntimeDescriptor(raw.descriptor);
  const appVersion = cleanOptionalString(raw.appVersion);
  if (appVersion !== descriptor.appVersion) {
    throw new Error("runtime descriptor appVersion does not match packaged config appVersion");
  }
  const namespace = normalizeNamespace(
    process.env[PACKAGED_NAMESPACE_ENV] ?? raw.namespace ?? SIDECAR_DEFAULTS.namespace,
  );
  const electronApp = await loadElectronApp();
  const portable = resolvePackagedPortable(raw.portable);
  const arch = resolvePortableTarget(portable, "arch", raw.arch, "x64");
  const artifact = resolvePortableTarget(portable, "artifact", raw.artifact, "portable-zip");
  const platform = resolvePortableTarget(portable, "platform", raw.platform, "win32");
  // Portable invariant: a portable extraction keeps ALL runtime data beside the
  // extracted exe (`<exeDir>/ReadableStudioData/namespaces`) so nothing lands in
  // %APPDATA% or the registry. In the win-unpacked/zip layout
  // `dirname(process.execPath)` IS the extraction root (resources/ sits beside
  // the exe), and everything else — daemon dataRoot, Chromium profile, logs,
  // and runtime state — derives from this single root (apps/packaged/src/paths.ts), so
  // branching only the fallback here relocates the whole tree.
  //
  // An explicit `namespaceBaseRoot` ALWAYS wins, including in portable mode:
  // portable only changes the *fallback*. tools/pack omits namespaceBaseRoot
  // from portable artifacts precisely so this branch is reached, but a caller
  // that bakes an explicit root (e.g. a relocated install) keeps it.
  const namespaceBaseRoot =
    resolveOptionalPath(raw.namespaceBaseRoot, "namespaceBaseRoot") ??
    (portable
      ? join(dirname(process.execPath), "ReadableStudioData", "namespaces")
      : join(dirname(electronApp.getPath("userData")), "Readable Studio", "namespaces"));
  const resourceRoot = resolveOptionalPath(raw.resourceRoot, "resourceRoot") ?? join(process.resourcesPath, "readable-studio");
  const relativeNodeCommand =
    raw.nodeCommandRelative == null || raw.nodeCommandRelative.length === 0
      ? resolveDefaultPackagedNodeCommandRelativePath()
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
    appVersion,
    arch,
    artifact,
    daemonCliEntry,
    daemonSidecarEntry,
    descriptor,
    namespace,
    namespaceBaseRoot,
    nodeCommand,
    portable,
    platform,
    resourceRoot,
    webSidecarEntry,
    webStandaloneRoot,
    webOutputMode,
  };
}
