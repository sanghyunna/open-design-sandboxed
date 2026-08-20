export const READABLE_STUDIO_HOST_GLOBAL = "__readableStudio__";
export const READABLE_STUDIO_HOST_VERSION = 3;

export const READABLE_STUDIO_HOST_CLIENT_TYPES = Object.freeze({
  DESKTOP: "desktop",
} as const);

export type ReadableStudioHostClientType =
  (typeof READABLE_STUDIO_HOST_CLIENT_TYPES)[keyof typeof READABLE_STUDIO_HOST_CLIENT_TYPES];

export type ReadableStudioHostClient = {
  // BCP-47 locale string (e.g. "zh-CN", "pt-BR") the host process read from
  // the OS at startup. The renderer uses this so the packaged desktop app
  // can follow the OS language even when Chromium's built-in
  // `navigator.language` would have defaulted to en-US.
  osLocale?: string;
  platform?: string;
  type: ReadableStudioHostClientType;
};

export type ReadableStudioHostFailure = {
  details?: unknown;
  ok: false;
  reason: string;
};

export type ReadableStudioHostActionResult =
  | { ok: true }
  | ReadableStudioHostFailure;

export type ReadableStudioHostProjectImportInit = {
  designSystemId?: string | null;
  name?: string;
  skillId?: string | null;
};

export type ReadableStudioHostProjectImportSuccess = {
  conversationId: string;
  entryFile: string | null;
  ok: true;
  projectId: string;
};

export type ReadableStudioHostProjectImportResult =
  | ReadableStudioHostProjectImportSuccess
  | {
      canceled: true;
      ok: false;
    }
  | ReadableStudioHostFailure;

export type ReadableStudioHostProjectReplaceWorkingDirSuccess = {
  baseDir: string;
  entryFile: string | null;
  ok: true;
};

export type ReadableStudioHostProjectReplaceWorkingDirResult =
  | ReadableStudioHostProjectReplaceWorkingDirSuccess
  | {
      canceled: true;
      ok: false;
    }
  | ReadableStudioHostFailure;

export type ReadableStudioHostPickWorkingDirSuccess = {
  baseDir: string;
  ok: true;
  // Single-use HMAC token (minted by the host main process for `baseDir`)
  // that the renderer threads into POST /api/projects/:id/working-dir once
  // the project exists. Lets the Home flow pick a folder before the project
  // is created without exposing the daemon's desktop-auth gate.
  token: string;
};

export type ReadableStudioHostPickWorkingDirResult =
  | ReadableStudioHostPickWorkingDirSuccess
  | {
      canceled: true;
      ok: false;
    }
  | ReadableStudioHostFailure;

export type ReadableStudioHostPdfPrintOptions = {
  deck?: boolean;
};

export type ReadableStudioHostCaptureClip = { x: number; y: number; width: number; height: number };
export type ReadableStudioHostCaptureOptions = { clip?: ReadableStudioHostCaptureClip };
export type ReadableStudioHostCaptureSuccess = { dataUrl: string; h: number; ok: true; w: number };
export type ReadableStudioHostCaptureResult = ReadableStudioHostCaptureSuccess | ReadableStudioHostFailure;

export type ReadableStudioHostBrowserClearDataOptions = {
  cookies?: boolean;
  storage?: boolean;
};

export const READABLE_STUDIO_HOST_UPDATER_ACTIONS = Object.freeze({
  CHECK: "check",
  DOWNLOAD: "download",
  INSTALL: "install",
  QUIT: "quit",
  STATUS: "status",
} as const);

export type ReadableStudioHostUpdaterAction =
  (typeof READABLE_STUDIO_HOST_UPDATER_ACTIONS)[keyof typeof READABLE_STUDIO_HOST_UPDATER_ACTIONS];
type ReadableStudioHostUpdaterStatusAction = Exclude<
  ReadableStudioHostUpdaterAction,
  typeof READABLE_STUDIO_HOST_UPDATER_ACTIONS.QUIT
>;

export const READABLE_STUDIO_HOST_UPDATER_STATES = Object.freeze({
  AVAILABLE: "available",
  CHECKING: "checking",
  DOWNLOADED: "downloaded",
  DOWNLOADING: "downloading",
  ERROR: "error",
  IDLE: "idle",
  INSTALLING: "installing",
  NOT_AVAILABLE: "not-available",
  UNSUPPORTED: "unsupported",
} as const);

export type ReadableStudioHostUpdaterState =
  (typeof READABLE_STUDIO_HOST_UPDATER_STATES)[keyof typeof READABLE_STUDIO_HOST_UPDATER_STATES];

export type ReadableStudioHostUpdaterMode = "js-incremental" | "package-launcher";
export type ReadableStudioHostUpdaterChannel = "beta" | "nightly" | "preview" | "stable";

export type ReadableStudioHostUpdaterActionOptions = {
  payload?: Record<string, unknown>;
};

export type ReadableStudioHostUpdaterCapabilitySet = {
  canApplyInPlace: boolean;
  canDownload: boolean;
  canOpenInstaller: boolean;
  requiresManualInstall: boolean;
};

export type ReadableStudioHostUpdaterPathSnapshot = {
  downloadRoot?: string;
  manifestPath?: string;
};

export type ReadableStudioHostUpdaterChecksumSnapshot = {
  algorithm: "sha256" | "sha512";
  url?: string;
  value?: string;
};

export type ReadableStudioHostUpdaterArtifactSnapshot = {
  name?: string;
  platformKey?: string;
  size?: number;
  type?: string;
  url: string;
};

export type ReadableStudioHostUpdaterProgressSnapshot = {
  receivedBytes: number;
  totalBytes?: number;
};

export type ReadableStudioHostUpdaterErrorSnapshot = {
  code: string;
  details?: unknown;
  message: string;
};

export type ReadableStudioHostUpdaterInstallResult = {
  activeVersion?: string;
  artifactPath?: string;
  dryRun?: boolean;
  helperLogPath?: string;
  launcherRuntimePath?: string;
  launchPath?: string;
  openedAt: string;
  path: string;
};

export type ReadableStudioHostUpdaterReleaseSnapshot = {
  arch: string;
  artifact: ReadableStudioHostUpdaterArtifactSnapshot;
  checksum: ReadableStudioHostUpdaterChecksumSnapshot;
  channel: ReadableStudioHostUpdaterChannel;
  downloadedAt: string;
  key: string;
  metadata?: Record<string, unknown>;
  path: string;
  platformKey: string;
  version: string;
};

export type ReadableStudioHostUpdaterIncomingSnapshot = {
  arch: string;
  artifact: ReadableStudioHostUpdaterArtifactSnapshot;
  channel: ReadableStudioHostUpdaterChannel;
  key?: string;
  metadata?: Record<string, unknown>;
  progress?: ReadableStudioHostUpdaterProgressSnapshot;
  startedAt: string;
  version: string;
};

export type ReadableStudioHostUpdaterCacheLifecycleTrigger = "cold-start" | "next-version-ready";

export type ReadableStudioHostUpdaterReleaseLifecycleState =
  | "cleanup-deferred"
  | "cleanup-removed"
  | "deprecated"
  | "retained"
  | "unknown";

export type ReadableStudioHostUpdaterCacheLifecycleSummary = {
  lastRunAt?: string;
  lastTrigger?: ReadableStudioHostUpdaterCacheLifecycleTrigger;
  platform: string;
  releases: {
    cleanupDeferred: number;
    cleanupRemoved: number;
    deprecated: number;
    errors: number;
    retained: number;
    total: number;
    unknown: number;
  };
};

export type ReadableStudioHostUpdaterCacheSnapshot = {
  lifecycle?: ReadableStudioHostUpdaterCacheLifecycleSummary;
};

export type ReadableStudioHostUpdaterStatusSnapshot = {
  active?: ReadableStudioHostUpdaterReleaseSnapshot;
  arch: string;
  artifact?: ReadableStudioHostUpdaterArtifactSnapshot;
  artifactUrl?: string;
  availableVersion?: string;
  cache?: ReadableStudioHostUpdaterCacheSnapshot;
  capabilities: ReadableStudioHostUpdaterCapabilitySet;
  channel: ReadableStudioHostUpdaterChannel;
  checksum?: ReadableStudioHostUpdaterChecksumSnapshot;
  currentVersion: string;
  downloadPath?: string;
  enabled: boolean;
  error?: ReadableStudioHostUpdaterErrorSnapshot;
  incoming?: ReadableStudioHostUpdaterIncomingSnapshot;
  installResult?: ReadableStudioHostUpdaterInstallResult;
  lastCheckedAt?: string;
  metadata?: Record<string, unknown>;
  mode: ReadableStudioHostUpdaterMode;
  paths?: ReadableStudioHostUpdaterPathSnapshot;
  platform: string;
  progress?: ReadableStudioHostUpdaterProgressSnapshot;
  state: ReadableStudioHostUpdaterState;
  supported: boolean;
};

export type ReadableStudioHostUpdaterResult =
  | { ok: true; status: ReadableStudioHostUpdaterStatusSnapshot }
  | ReadableStudioHostFailure;

export type ReadableStudioHostUpdaterStatusListener = (status: ReadableStudioHostUpdaterStatusSnapshot) => void;

export type ReadableStudioHostBridge = {
  browser: {
    clearData(options?: ReadableStudioHostBrowserClearDataOptions): Promise<ReadableStudioHostActionResult>;
  };
  capture: {
    page(options?: ReadableStudioHostCaptureOptions): Promise<ReadableStudioHostCaptureResult>;
  };
  client: ReadableStudioHostClient;
  pdf: {
    print(html: string, nonce?: string, options?: ReadableStudioHostPdfPrintOptions): Promise<ReadableStudioHostActionResult>;
  };
  pet: {
    setVisible(visible: boolean): void;
  };
  project: {
    pickAndImport(init?: ReadableStudioHostProjectImportInit): Promise<ReadableStudioHostProjectImportResult>;
    pickAndReplaceWorkingDir(projectId: string): Promise<ReadableStudioHostProjectReplaceWorkingDirResult>;
    // Optional so older host builds still satisfy the bridge shape; callers
    // must feature-detect before invoking.
    pickWorkingDir?(): Promise<ReadableStudioHostPickWorkingDirResult>;
  };
  shell: {
    openExternal(url: string): Promise<ReadableStudioHostActionResult>;
    openPath(projectId: string): Promise<ReadableStudioHostActionResult>;
  };
  updater: {
    check(options?: ReadableStudioHostUpdaterActionOptions): Promise<ReadableStudioHostUpdaterStatusSnapshot>;
    download(options?: ReadableStudioHostUpdaterActionOptions): Promise<ReadableStudioHostUpdaterStatusSnapshot>;
    install(options?: ReadableStudioHostUpdaterActionOptions): Promise<ReadableStudioHostUpdaterStatusSnapshot>;
    quit(options?: ReadableStudioHostUpdaterActionOptions): Promise<ReadableStudioHostActionResult>;
    status(options?: ReadableStudioHostUpdaterActionOptions): Promise<ReadableStudioHostUpdaterStatusSnapshot>;
    subscribe(listener: ReadableStudioHostUpdaterStatusListener): () => void;
  };
  version: typeof READABLE_STUDIO_HOST_VERSION;
};

export type ReadableStudioHostGlobalScope = Record<string, unknown> & {
  window?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function failure(reason: string, details?: unknown): ReadableStudioHostFailure {
  return {
    ...(details === undefined ? {} : { details }),
    ok: false,
    reason,
  };
}

function hasFunction(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === "function";
}

export function isReadableStudioHostBridge(value: unknown): value is ReadableStudioHostBridge {
  if (!isRecord(value)) return false;
  if (value.version !== READABLE_STUDIO_HOST_VERSION) return false;
  const client = value.client;
  if (!isRecord(client) || client.type !== READABLE_STUDIO_HOST_CLIENT_TYPES.DESKTOP) return false;
  if (client.platform != null && typeof client.platform !== "string") return false;
  if (client.osLocale != null && typeof client.osLocale !== "string") return false;

  const shell = value.shell;
  if (!isRecord(shell) || !hasFunction(shell, "openExternal") || !hasFunction(shell, "openPath")) return false;

  const browser = value.browser;
  if (!isRecord(browser) || !hasFunction(browser, "clearData")) return false;

  const capture = value.capture;
  if (!isRecord(capture) || !hasFunction(capture, "page")) return false;

  const project = value.project;
  if (
    !isRecord(project) ||
    !hasFunction(project, "pickAndImport") ||
    !hasFunction(project, "pickAndReplaceWorkingDir")
  ) {
    return false;
  }

  const pdf = value.pdf;
  if (!isRecord(pdf) || !hasFunction(pdf, "print")) return false;

  const pet = value.pet;
  if (!isRecord(pet) || !hasFunction(pet, "setVisible")) return false;

  const updater = value.updater;
  if (
    !isRecord(updater) ||
    !hasFunction(updater, "status") ||
    !hasFunction(updater, "check") ||
    !hasFunction(updater, "download") ||
    !hasFunction(updater, "install") ||
    !hasFunction(updater, "quit") ||
    !hasFunction(updater, "subscribe")
  ) {
    return false;
  }

  return true;
}

/**
 * Converts a privileged host adapter's raw project-import result into the
 * host-owned renderer contract. The adapter may internally call daemon APIs,
 * but only project identifiers cross the host bridge.
 */
export function normalizeReadableStudioHostProjectImportResult(input: unknown): ReadableStudioHostProjectImportResult {
  if (!isRecord(input)) {
    return failure("desktop import returned an invalid response", input);
  }
  if (input.ok !== true) {
    if (input.canceled === true) return { canceled: true, ok: false };
    const reason = typeof input.reason === "string" && input.reason.length > 0
      ? input.reason
      : "unknown failure";
    return failure(reason, input.details);
  }

  const response = input.response;
  if (!isRecord(response)) {
    return failure("daemon import response was not an object", response);
  }
  const project = response.project;
  const rawProjectId = isRecord(project) ? project.id : null;
  const projectId = typeof rawProjectId === "string" ? rawProjectId : null;
  const conversationId = typeof response.conversationId === "string" ? response.conversationId : null;
  const entryFile =
    typeof response.entryFile === "string" || response.entryFile === null
      ? response.entryFile
      : undefined;
  if (projectId == null || conversationId == null || entryFile === undefined) {
    return failure("daemon import response did not include host project identifiers", response);
  }

  return {
    conversationId,
    entryFile,
    ok: true,
    projectId,
  };
}

export function normalizeReadableStudioHostProjectReplaceWorkingDirResult(
  input: unknown,
): ReadableStudioHostProjectReplaceWorkingDirResult {
  if (!isRecord(input)) {
    return failure("desktop working-dir replace returned an invalid response", input);
  }
  if (input.ok !== true) {
    if (input.canceled === true) return { canceled: true, ok: false };
    const reason = typeof input.reason === "string" && input.reason.length > 0
      ? input.reason
      : "unknown failure";
    return failure(reason, input.details);
  }

  const response = input.response;
  if (!isRecord(response)) {
    return failure("daemon working-dir response was not an object", response);
  }
  const baseDir = typeof response.baseDir === "string" ? response.baseDir : null;
  const entryFile = typeof response.entryFile === "string" ? response.entryFile : null;
  if (baseDir == null) {
    return failure("daemon working-dir response did not include baseDir", response);
  }

  return { baseDir, entryFile, ok: true };
}

export function normalizeReadableStudioHostPickWorkingDirResult(
  input: unknown,
): ReadableStudioHostPickWorkingDirResult {
  if (!isRecord(input)) {
    return failure("desktop working-dir pick returned an invalid response", input);
  }
  if (input.ok !== true) {
    if (input.canceled === true) return { canceled: true, ok: false };
    const reason = typeof input.reason === "string" && input.reason.length > 0
      ? input.reason
      : "unknown failure";
    return failure(reason, input.details);
  }
  const baseDir = typeof input.baseDir === "string" ? input.baseDir : null;
  const token = typeof input.token === "string" ? input.token : null;
  if (baseDir == null || token == null) {
    return failure("desktop working-dir pick did not include baseDir and token", input);
  }
  return { baseDir, ok: true, token };
}

function candidateFromScope(scope: ReadableStudioHostGlobalScope): unknown {
  if (READABLE_STUDIO_HOST_GLOBAL in scope) return scope[READABLE_STUDIO_HOST_GLOBAL];
  const windowValue = scope.window;
  if (isRecord(windowValue) && READABLE_STUDIO_HOST_GLOBAL in windowValue) {
    return windowValue[READABLE_STUDIO_HOST_GLOBAL];
  }
  return undefined;
}

export function getReadableStudioHost(scope: ReadableStudioHostGlobalScope = globalThis): ReadableStudioHostBridge | null {
  const candidate = candidateFromScope(scope);
  return isReadableStudioHostBridge(candidate) ? candidate : null;
}

export function isReadableStudioHostAvailable(scope: ReadableStudioHostGlobalScope = globalThis): boolean {
  return getReadableStudioHost(scope) != null;
}

export function detectReadableStudioHostClientType(scope: ReadableStudioHostGlobalScope = globalThis): ReadableStudioHostClientType | "web" {
  return getReadableStudioHost(scope)?.client.type ?? "web";
}

function unavailable(reason: string): ReadableStudioHostFailure {
  return failure(reason);
}

export async function openHostExternalUrl(url: string, scope: ReadableStudioHostGlobalScope = globalThis): Promise<ReadableStudioHostActionResult> {
  const host = getReadableStudioHost(scope);
  if (host == null) return unavailable("Readable Studio host is not available");
  try {
    return await host.shell.openExternal(url);
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

export async function openHostProjectPath(projectId: string, scope: ReadableStudioHostGlobalScope = globalThis): Promise<ReadableStudioHostActionResult> {
  const host = getReadableStudioHost(scope);
  if (host == null) return unavailable("Readable Studio host is not available");
  try {
    return await host.shell.openPath(projectId);
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

export async function clearHostBrowserData(
  options?: ReadableStudioHostBrowserClearDataOptions,
  scope: ReadableStudioHostGlobalScope = globalThis,
): Promise<ReadableStudioHostActionResult> {
  const host = getReadableStudioHost(scope);
  if (host == null) return unavailable("Readable Studio host is not available");
  try {
    return await host.browser.clearData(options);
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

export async function captureHostPage(
  options?: ReadableStudioHostCaptureOptions,
  scope: ReadableStudioHostGlobalScope = globalThis,
): Promise<ReadableStudioHostCaptureResult> {
  const host = getReadableStudioHost(scope);
  if (host == null) return unavailable("Readable Studio host is not available");
  try {
    return await host.capture.page(options);
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

export async function pickAndImportHostProject(
  init?: ReadableStudioHostProjectImportInit,
  scope: ReadableStudioHostGlobalScope = globalThis,
): Promise<ReadableStudioHostProjectImportResult> {
  const host = getReadableStudioHost(scope);
  if (host == null) return unavailable("Readable Studio host is not available");
  try {
    return await host.project.pickAndImport(init);
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

export async function pickAndReplaceHostProjectWorkingDir(
  projectId: string,
  scope: ReadableStudioHostGlobalScope = globalThis,
): Promise<ReadableStudioHostProjectReplaceWorkingDirResult> {
  const host = getReadableStudioHost(scope);
  if (host == null) return unavailable("Readable Studio host is not available");
  try {
    return await host.project.pickAndReplaceWorkingDir(projectId);
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

// Picks a folder via the host's native dialog and returns the chosen path
// plus a single-use token, WITHOUT touching any project. The Home flow uses
// this to let the user choose a working directory before the project exists;
// the token is later spent on POST /api/projects/:id/working-dir.
export async function pickHostWorkingDir(
  scope: ReadableStudioHostGlobalScope = globalThis,
): Promise<ReadableStudioHostPickWorkingDirResult> {
  const host = getReadableStudioHost(scope);
  if (host == null) return unavailable("Readable Studio host is not available");
  if (typeof host.project.pickWorkingDir !== "function") {
    return unavailable("host build does not support pickWorkingDir");
  }
  try {
    return await host.project.pickWorkingDir();
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

export async function printHostPdf(
  html: string,
  nonce?: string,
  options?: ReadableStudioHostPdfPrintOptions,
  scope: ReadableStudioHostGlobalScope = globalThis,
): Promise<ReadableStudioHostActionResult> {
  const host = getReadableStudioHost(scope);
  if (host == null) return unavailable("Readable Studio host is not available");
  try {
    return await host.pdf.print(html, nonce, options);
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

export function setHostPetVisible(visible: boolean, scope: ReadableStudioHostGlobalScope = globalThis): ReadableStudioHostActionResult {
  const host = getReadableStudioHost(scope);
  if (host == null) return unavailable("Readable Studio host is not available");
  try {
    host.pet.setVisible(visible);
    return { ok: true };
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

async function runHostUpdaterAction(
  action: ReadableStudioHostUpdaterStatusAction,
  options?: ReadableStudioHostUpdaterActionOptions,
  scope: ReadableStudioHostGlobalScope = globalThis,
): Promise<ReadableStudioHostUpdaterResult> {
  const host = getReadableStudioHost(scope);
  if (host == null) return unavailable("Readable Studio host is not available");
  try {
    return {
      ok: true,
      status: await host.updater[action](options),
    };
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

export async function getHostUpdaterStatus(
  options?: ReadableStudioHostUpdaterActionOptions,
  scope: ReadableStudioHostGlobalScope = globalThis,
): Promise<ReadableStudioHostUpdaterResult> {
  return await runHostUpdaterAction(READABLE_STUDIO_HOST_UPDATER_ACTIONS.STATUS, options, scope);
}

export async function checkHostUpdater(
  options?: ReadableStudioHostUpdaterActionOptions,
  scope: ReadableStudioHostGlobalScope = globalThis,
): Promise<ReadableStudioHostUpdaterResult> {
  return await runHostUpdaterAction(READABLE_STUDIO_HOST_UPDATER_ACTIONS.CHECK, options, scope);
}

export async function downloadHostUpdater(
  options?: ReadableStudioHostUpdaterActionOptions,
  scope: ReadableStudioHostGlobalScope = globalThis,
): Promise<ReadableStudioHostUpdaterResult> {
  return await runHostUpdaterAction(READABLE_STUDIO_HOST_UPDATER_ACTIONS.DOWNLOAD, options, scope);
}

export async function installHostUpdater(
  options?: ReadableStudioHostUpdaterActionOptions,
  scope: ReadableStudioHostGlobalScope = globalThis,
): Promise<ReadableStudioHostUpdaterResult> {
  return await runHostUpdaterAction(READABLE_STUDIO_HOST_UPDATER_ACTIONS.INSTALL, options, scope);
}

export async function quitHostAfterUpdaterInstallerOpen(
  options?: ReadableStudioHostUpdaterActionOptions,
  scope: ReadableStudioHostGlobalScope = globalThis,
): Promise<ReadableStudioHostActionResult> {
  const host = getReadableStudioHost(scope);
  if (host == null) return unavailable("Readable Studio host is not available");
  try {
    return await host.updater.quit(options);
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

export function subscribeHostUpdater(
  listener: ReadableStudioHostUpdaterStatusListener,
  scope: ReadableStudioHostGlobalScope = globalThis,
): () => void {
  const host = getReadableStudioHost(scope);
  if (host == null) return () => undefined;
  try {
    return host.updater.subscribe(listener);
  } catch {
    return () => undefined;
  }
}
