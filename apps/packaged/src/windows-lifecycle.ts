import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { resolveWindowsUninstallRegistryKey } from "@open-design/sidecar-proto";

const execFileAsync = promisify(execFile);

export type WindowsRegistryExec = (
  command: string,
  args: string[],
  options: { windowsHide: true },
) => Promise<unknown>;

export type SyncWindowsUninstallDisplayVersionInput = {
  exec?: WindowsRegistryExec;
  namespace: string;
  platform?: NodeJS.Platform;
  // True for portable-zip runs. A portable extraction must never touch the
  // registry — including this query-first sync: when an INSTALLED copy of the
  // same namespace exists, its uninstall key is present, and the sync would
  // stamp that installed copy's DisplayVersion with the portable run's version
  // (a registry write from a run whose invariant is "nothing lands in the
  // registry", and wrong data for the installed copy). Guarded here rather
  // than at the call site so no future caller can forget it.
  portable?: boolean;
  version: string | null;
};

// @dsp func-a30c2aa0
export function windowsUninstallRegistryQueryArgs(input: {
  namespace: string;
}): string[] {
  return [
    "query",
    `HKCU\\${resolveWindowsUninstallRegistryKey(input.namespace)}`,
  ];
}

// @dsp func-1121da79
export function windowsUninstallDisplayVersionRegistryArgs(input: {
  namespace: string;
  version: string;
}): string[] {
  return [
    "add",
    `HKCU\\${resolveWindowsUninstallRegistryKey(input.namespace)}`,
    "/v",
    "DisplayVersion",
    "/t",
    "REG_SZ",
    "/d",
    input.version,
    "/f",
  ];
}

// @dsp func-fa1fff72
export async function syncWindowsUninstallDisplayVersion(
  input: SyncWindowsUninstallDisplayVersionInput,
): Promise<boolean> {
  if (input.portable === true) return false;
  if ((input.platform ?? process.platform) !== "win32") return false;
  const version = input.version?.trim();
  if (version == null || version.length === 0) return false;
  const run = input.exec ?? execFileAsync;
  try {
    await run("reg.exe", windowsUninstallRegistryQueryArgs({
      namespace: input.namespace,
    }), { windowsHide: true });
  } catch {
    return false;
  }
  await run("reg.exe", windowsUninstallDisplayVersionRegistryArgs({
    namespace: input.namespace,
    version,
  }), { windowsHide: true });
  return true;
}
