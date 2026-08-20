import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  SIDECAR_CONTRACT,
  SIDECAR_DEFAULTS,
} from "@readable-studio/sidecar-proto";
import { resolveNamespace } from "@readable-studio/sidecar";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const WORKSPACE_ROOT = resolve(__dirname, "../../..");

export type ToolPackPlatform = "win";
export type ToolPackBuildOutput = "zip";
export type ToolPackWebOutputMode = "server" | "standalone";
export type ToolPackAmrProfile = "prod" | "test" | "local";
type ToolPackPrereleaseChannel = "beta" | "nightly" | "preview";

export type ToolPackCliOptions = {
  appVersion?: string;
  cacheDir?: string;
  dir?: string;
  expr?: string;
  json?: boolean;
  namespace?: string;
  path?: string;
  portable?: boolean;
  removeData?: boolean;
  removeLogs?: boolean;
  removeProductUserData?: boolean;
  removeSidecars?: boolean;
  requireVelaCli?: boolean;
  signed?: boolean;
  silent?: boolean;
  to?: string;
  updateAction?: string;
};

export type ToolPackRoots = {
  output: {
    appBuilderRoot: string;
    namespaceRoot: string;
    platformRoot: string;
    root: string;
  };
  runtime: {
    namespaceBaseRoot: string;
    namespaceRoot: string;
  };
  cacheRoot: string;
  toolPackRoot: string;
};

export type ToolPackConfig = {
  appVersion?: string;
  electronBuilderCliPath: string;
  electronDistPath: string;
  electronVersion: string;
  namespace: string;
  platform: ToolPackPlatform;
  portable: boolean;
  removeData: boolean;
  removeLogs: boolean;
  removeProductUserData: boolean;
  removeSidecars: boolean;
  requireVelaCli: boolean;
  roots: ToolPackRoots;
  signed: boolean;
  silent: boolean;
  amrProfile?: ToolPackAmrProfile;
  updateMetadataUrl?: string;
  to: ToolPackBuildOutput;
  webOutputMode: ToolPackWebOutputMode;
  workspaceRoot: string;
};

function resolveToolPackBuildOutput(value: string | undefined): ToolPackBuildOutput {
  if (value == null || value.length === 0) return "zip";
  if (value === "zip") return value;
  throw new Error(`unsupported win --to target: ${value}`);
}

function resolveToolPackAppVersion(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error("--app-version must not be empty");
  if (/\s/.test(normalized)) throw new Error(`--app-version must not contain whitespace: ${value}`);
  return normalized;
}

function channelFromAppVersion(value: string | undefined): ToolPackPrereleaseChannel | null {
  if (value == null || value.length === 0) return null;
  if (/(?:^|[-.])beta(?:[-.]|$)/i.test(value)) return "beta";
  if (/(?:^|[-.])nightly(?:[-.]|$)/i.test(value)) return "nightly";
  if (/(?:^|[-.])preview(?:[-.]|$)/i.test(value)) return "preview";
  return null;
}

function defaultNamespaceForAppVersion(appVersion: string | undefined): string {
  const channel = channelFromAppVersion(appVersion);
  if (channel == null) return SIDECAR_DEFAULTS.namespace;
  return `release-${channel}-win`;
}

function resolveToolPackWebOutputMode(value: string | undefined): ToolPackWebOutputMode {
  if (value == null || value.length === 0) return "standalone";
  if (value === "server" || value === "standalone") return value;
  throw new Error(`unsupported OD_WEB_OUTPUT_MODE value: ${value}`);
}

function resolveToolPackAmrProfile(value: string | undefined): ToolPackAmrProfile | undefined {
  if (value == null) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  if (normalized === "prod" || normalized === "test" || normalized === "local") return normalized;
  throw new Error(`OPEN_DESIGN_AMR_PROFILE must be prod, test, or local: ${value}`);
}

function resolveToolPackUpdateMetadataUrl(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`OD_UPDATE_METADATA_URL must be an absolute URL: ${value}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`OD_UPDATE_METADATA_URL must use http(s): ${value}`);
  }
  return normalized;
}

function resolveElectronVersion(workspaceRoot: string): string {
  const require = createRequire(join(workspaceRoot, "apps/desktop/package.json"));
  const desktopPackage = require(join(workspaceRoot, "apps/desktop/package.json")) as {
    devDependencies?: Record<string, string>;
  };
  const version = desktopPackage.devDependencies?.electron;
  if (version == null || version.length === 0) {
    throw new Error("apps/desktop/package.json must declare electron");
  }
  return version;
}

function resolveElectronDistPath(workspaceRoot: string): string {
  const require = createRequire(join(workspaceRoot, "apps/desktop/package.json"));
  const electronEntry = require.resolve("electron");
  return join(path.dirname(electronEntry), "dist");
}

function resolveElectronBuilderCliPath(): string {
  const require = createRequire(import.meta.url);
  return require.resolve("electron-builder/out/cli/cli.js");
}

export function resolveToolPackConfig(
  platform: ToolPackPlatform,
  options: ToolPackCliOptions = {},
): ToolPackConfig {
  const appVersion = resolveToolPackAppVersion(options.appVersion);
  const namespace = resolveNamespace({
    contract: SIDECAR_CONTRACT,
    env: process.env,
    namespace: options.namespace ?? defaultNamespaceForAppVersion(appVersion),
  });
  const toolPackRoot = resolve(options.dir ?? join(WORKSPACE_ROOT, ".tmp", "tools-pack"));
  const cacheRoot = resolve(options.cacheDir ?? join(toolPackRoot, "cache"));
  const outputRoot = join(toolPackRoot, "out");
  const outputPlatformRoot = join(outputRoot, platform);
  const outputNamespaceRoot = join(outputPlatformRoot, "namespaces", namespace);
  const runtimeNamespaceBaseRoot = join(toolPackRoot, "runtime", platform, "namespaces");

  return {
    appVersion,
    electronBuilderCliPath: resolveElectronBuilderCliPath(),
    electronDistPath: resolveElectronDistPath(WORKSPACE_ROOT),
    electronVersion: resolveElectronVersion(WORKSPACE_ROOT),
    namespace,
    platform,
    portable: options.portable === true,
    roots: {
      output: {
        appBuilderRoot: join(outputNamespaceRoot, "builder"),
        namespaceRoot: outputNamespaceRoot,
        platformRoot: outputPlatformRoot,
        root: outputRoot,
      },
      runtime: {
        namespaceBaseRoot: runtimeNamespaceBaseRoot,
        namespaceRoot: join(runtimeNamespaceBaseRoot, namespace),
      },
      cacheRoot,
      toolPackRoot,
    },
    removeData: options.removeData === true,
    removeLogs: options.removeLogs === true,
    removeProductUserData: options.removeProductUserData === true,
    removeSidecars: options.removeSidecars === true,
    requireVelaCli: options.requireVelaCli === true,
    signed: options.signed === true,
    silent: options.silent !== false,
    amrProfile: resolveToolPackAmrProfile(process.env.OPEN_DESIGN_AMR_PROFILE),
    updateMetadataUrl: resolveToolPackUpdateMetadataUrl(process.env.OD_UPDATE_METADATA_URL),
    to: resolveToolPackBuildOutput(options.to),
    webOutputMode: resolveToolPackWebOutputMode(process.env.OD_WEB_OUTPUT_MODE),
    workspaceRoot: WORKSPACE_ROOT,
  };
}
