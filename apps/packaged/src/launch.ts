import { access, appendFile, mkdir, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join } from "node:path";
import { userInfo } from "node:os";

import { app } from "electron";
import { APP_KEYS, SIDECAR_CONTRACT, SIDECAR_MESSAGES, type DesktopStatusSnapshot } from "@readable-studio/sidecar-proto";
import { requestJsonIpc, resolveAppIpcPath } from "@readable-studio/sidecar";

import { PackagedPathAccessError } from "./errors.js";
import type { PackagedNamespacePaths } from "./paths.js";

type PackagedLaunchLogger = Pick<Console, "warn"> & Partial<Pick<Console, "info">>;

export type PackagedExistingDesktopGateResult =
  | { action: "continue"; reason: "inspect-failed" | "not-running" }
  | { action: "exit"; reason: "existing-focused" | "existing-focus-failed" };

export type PackagedSingleInstanceApp = {
  on: (event: "second-instance", listener: () => void) => unknown;
  quit: () => void;
  requestSingleInstanceLock: () => boolean;
};
type PathDiagnostic = {
  exists: boolean;
  mode?: number;
  path: string;
};

function formatMode(mode: number | undefined): string {
  if (mode == null) return "unknown";
  return `0${(mode & 0o777).toString(8)}`;
}

async function inspectPath(path: string): Promise<PathDiagnostic> {
  try {
    const stats = await stat(path);
    return { exists: true, mode: stats.mode, path };
  } catch {
    return { exists: false, path };
  }
}

function formatWritablePathError(options: {
  attemptedPath: string;
  currentUser: string;
  diagnostic: PathDiagnostic;
  error: unknown;
  parentDiagnostic: PathDiagnostic;
}): string {
  const { attemptedPath, currentUser, diagnostic, error, parentDiagnostic } = options;
  const message = error instanceof Error ? error.message : String(error);
  const parentPath = dirname(attemptedPath);
  const diagLines = [
    `Readable Studio could not create or write to:`,
    attemptedPath,
    "",
    `Current user: ${currentUser}`,
    `Node error: ${message}`,
    `Target exists: ${diagnostic.exists ? "yes" : "no"}`,
    `Target mode: ${formatMode(diagnostic.mode)}`,
    `Parent exists: ${parentDiagnostic.exists ? "yes" : "no"}`,
    `Parent mode: ${formatMode(parentDiagnostic.mode)}`,
    "",
    `Common causes:`,
    `• the folder was created by another user (for example with sudo)`,
    `• the parent folder is not writable`,
    `• the folder is a symlink to a protected location`,
    "",
    `Try in Terminal:`,
    `ls -ld \"${parentPath}\" \"${attemptedPath}\"`,
    `sudo chown -R \"${currentUser}\":staff \"${parentPath}\"`,
    `chmod -R u+rwX \"${parentPath}\"`,
  ];
  return diagLines.join("\n");
}

// @dsp func-77b5e7da
export async function verifyPackagedDataRootWritable(paths: Pick<PackagedNamespacePaths, "dataRoot">): Promise<void> {
  try {
    await mkdir(paths.dataRoot, { recursive: true });
    await access(paths.dataRoot, fsConstants.W_OK);
  } catch (error) {
    const [diagnostic, parentDiagnostic] = await Promise.all([
      inspectPath(paths.dataRoot),
      inspectPath(dirname(paths.dataRoot)),
    ]);
    throw new PackagedPathAccessError(
      formatWritablePathError({
        attemptedPath: paths.dataRoot,
        currentUser: userInfo().username,
        diagnostic,
        error,
        parentDiagnostic,
      }),
      { cause: error },
    );
  }
}

// @dsp func-230150b6
export async function ensurePackagedNamespacePaths(
  paths: PackagedNamespacePaths,
): Promise<void> {
  await verifyPackagedDataRootWritable(paths);
  await Promise.all([
    mkdir(paths.namespaceRoot, { recursive: true }),
    mkdir(paths.cacheRoot, { recursive: true }),
    mkdir(paths.dataRoot, { recursive: true }),
    mkdir(paths.logsRoot, { recursive: true }),
    mkdir(paths.desktopLogsRoot, { recursive: true }),
    mkdir(paths.runtimeRoot, { recursive: true }),
    mkdir(paths.electronUserDataRoot, { recursive: true }),
    mkdir(paths.electronSessionDataRoot, { recursive: true }),
  ]);
}

// @dsp func-3debd19d
async function writePackagedStartupLog(paths: PackagedNamespacePaths, message: string): Promise<void> {
  const logDir = dirname(paths.desktopLogPath);
  await mkdir(logDir, { recursive: true });
  await appendFile(join(logDir, "startup.log"), `${new Date().toISOString()} ${message}\n`, "utf8");
}

export async function inspectExistingPackagedDesktop(
  namespace: string,
  options: {
    logger?: PackagedLaunchLogger;
    paths: PackagedNamespacePaths;
    requestIpc?: typeof requestJsonIpc;
  },
): Promise<PackagedExistingDesktopGateResult> {
  const logger = options.logger ?? console;
  const requestIpc = options.requestIpc ?? requestJsonIpc;
  const ipcPath = resolveAppIpcPath({ app: APP_KEYS.DESKTOP, contract: SIDECAR_CONTRACT, namespace });
  let status: DesktopStatusSnapshot | null = null;
  try {
    status = await requestIpc<DesktopStatusSnapshot>(
      ipcPath,
      { type: SIDECAR_MESSAGES.STATUS },
      { timeoutMs: 350 },
    );
  } catch (error) {
    const message = `inspect-unavailable namespace=${namespace} action=continue error=${error instanceof Error ? error.message : String(error)}`;
    await writePackagedStartupLog(options.paths, message);
    logger.info?.(`[readable-studio startup] ${message}`);
    return { action: "continue", reason: "inspect-failed" };
  }

  if (status.state !== "running") {
    await writePackagedStartupLog(options.paths, `inspect-not-running namespace=${namespace} state=${status.state}`);
    return { action: "continue", reason: "not-running" };
  }

  try {
    await requestIpc(ipcPath, { type: SIDECAR_MESSAGES.SHOW }, { timeoutMs: 800 });
    await writePackagedStartupLog(options.paths, `inspect-found-existing namespace=${namespace} focus=accepted`);
    return { action: "exit", reason: "existing-focused" };
  } catch (error) {
    const message = `inspect-found-existing namespace=${namespace} focus=failed error=${error instanceof Error ? error.message : String(error)}`;
    await writePackagedStartupLog(options.paths, message);
    logger.warn(`[readable-studio startup] ${message}`);
    return { action: "exit", reason: "existing-focus-failed" };
  }
}

export function applyPackagedElectronPathOverrides(
  paths: PackagedNamespacePaths,
): void {
  app.setPath("userData", paths.electronUserDataRoot);
  app.setPath("sessionData", paths.electronSessionDataRoot);
  app.setPath("logs", paths.desktopLogsRoot);
}

// @dsp func-a5f43a0f
export function claimPackagedSingleInstanceLock(
  electronApp: PackagedSingleInstanceApp,
  onSecondInstance: () => void,
): boolean {
  if (!electronApp.requestSingleInstanceLock()) {
    electronApp.quit();
    return false;
  }
  electronApp.on("second-instance", () => {
    onSecondInstance();
  });
  return true;
}
