import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import type { ToolPackConfig } from "../config.js";
import { winResources } from "../resources.js";
import { removeTree } from "./fs.js";
import type { WinBuiltAppManifest, WinPackTiming, WinPaths } from "./types.js";

const execFileAsync = promisify(execFile);

// Relative path of the packaged config inside both the unpacked tree and the
// archive. The portable flag is injected ONLY into the zip's copy of this file.
const PACKAGED_CONFIG_ARCHIVE_RELATIVE_PATH = "resources/open-design-config.json";

// Adds the portable signal to a packaged `open-design-config.json` payload,
// preserving every other (including unknown) field and re-serializing in the
// exact shape tools/pack writes it everywhere else — `JSON.stringify(obj, null,
// 2)` followed by a trailing newline (see writePackagedConfigFile in
// tools/pack/src/win/manifest.ts and the unpacked-tree write in
// builder.ts:430). `portable` is appended after the existing keys (insertion
// order), so a clean round-trip is deterministic and stable across rebuilds.
//
// Zip-only injection (Trap 1, refactor_ideas.md §3.4): the portable zip and the
// NSIS installer are assembled from the SAME cached win-unpacked tree. Baking
// `portable: true` into that shared tree would flip NSIS installs to portable
// too. So this patch is applied to a STAGING copy and added to the zip with a
// second `7z a` pass; the shared win-unpacked tree is never written.
//
// The patch must also DROP any baked `namespaceBaseRoot`: a non-`--portable`
// build bakes the build machine's tools-pack runtime root into the shared
// tree's config (manifest.ts), and the runtime lets an explicit
// `namespaceBaseRoot` win over the portable exe-adjacent fallback — so leaving
// it in place would ship a build-machine path inside the portable artifact and
// defeat exe-adjacent data entirely. Stripping it also makes the zip's config
// identical whether or not `--portable` was passed, so the cached zip can never
// be a flag-dependent artifact.
export function withPortableConfigFlag(configJsonText: string): string {
  const parsed = JSON.parse(configJsonText) as Record<string, unknown>;
  delete parsed.namespaceBaseRoot;
  parsed.portable = true;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function logWinZipProgress(message: string, fields: Record<string, unknown> = {}): void {
  const suffix = Object.entries(fields)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  process.stderr.write(`[tools-pack win] ${message}${suffix.length === 0 ? "" : ` ${suffix}`}\n`);
}

// Produces a portable zip from the unpacked Electron build using the same 7z
// binary that ships with tools-pack for the NSIS payload. The zip lays files
// flat at the archive root so that users can extract it anywhere on Windows
// and run `Open Design.exe` without going through the NSIS installer.
//
// We deliberately do not delegate this to electron-builder's native `zip`
// target: the existing tools-pack flow forces electron-builder to `to: "dir"`
// so the cached `win-unpacked` output can be shared across cache hits and
// post-processed into the custom NSIS installer. Producing the zip from that
// same cached unpacked tree keeps the build deterministic and avoids a
// second electron-builder pass.
//
// The zip IS the portable artifact (its filename is `-portable.zip`), so it
// always carries `portable: true`. Because the unpacked tree is shared with the
// NSIS installer, we inject that flag zip-only: after the main archive pass we
// add a patched `open-design-config.json` from a staging dir with a second
// `7z a` pass (`a` replaces the matching entry already in the archive). See
// withPortableConfigFlag and Trap 1 in refactor_ideas.md §3.4.
export async function buildWinPortableZip(
  _config: ToolPackConfig,
  paths: WinPaths,
  builtApp: WinBuiltAppManifest,
): Promise<WinPackTiming[]> {
  if (process.platform !== "win32") throw new Error("Windows portable zip build must run on Windows");
  const timings: WinPackTiming[] = [];
  const runSegment = async <T>(phase: string, task: () => Promise<T>): Promise<T> => {
    const startedAt = Date.now();
    logWinZipProgress("segment:start", { phase });
    try {
      const result = await task();
      logWinZipProgress("segment:done", { durationMs: Date.now() - startedAt, phase });
      return result;
    } catch (error) {
      logWinZipProgress("segment:failed", {
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        phase,
      });
      throw error;
    } finally {
      timings.push({ durationMs: Date.now() - startedAt, phase });
    }
  };
  const runExecSegment = async (
    phase: string,
    command: string,
    args: string[],
    options: { cwd: string; outputPath?: string },
  ): Promise<void> => {
    const startedAt = Date.now();
    const details: Record<string, unknown> = {
      args,
      command,
      cwd: options.cwd,
    };
    logWinZipProgress("segment:start", { phase });
    try {
      const result = await execFileAsync(command, args, {
        cwd: options.cwd,
        windowsHide: true,
      });
      details.stdoutBytes = result.stdout.length;
      details.stderrBytes = result.stderr.length;
      details.stdoutTail = result.stdout.slice(-2000);
      details.stderrTail = result.stderr.slice(-2000);
      if (options.outputPath != null) {
        details.outputBytes = (await stat(options.outputPath)).size;
        details.outputPath = options.outputPath;
      }
      logWinZipProgress("segment:done", { durationMs: Date.now() - startedAt, phase });
      timings.push({ details, durationMs: Date.now() - startedAt, phase });
    } catch (error) {
      const failure = error as { code?: unknown; stderr?: unknown; stdout?: unknown };
      details.code = failure.code;
      details.stdoutTail = typeof failure.stdout === "string" ? failure.stdout.slice(-2000) : undefined;
      details.stderrTail = typeof failure.stderr === "string" ? failure.stderr.slice(-2000) : undefined;
      logWinZipProgress("segment:failed", {
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        phase,
      });
      timings.push({ details, durationMs: Date.now() - startedAt, phase });
      throw error;
    }
  };

  await runSegment("portable-zip:prepare", async () => {
    await mkdir(dirname(paths.setupZipPath), { recursive: true });
    await rm(paths.setupZipPath, { force: true });
  });
  await runSegment("portable-zip:7z", async () => {
    await runExecSegment(
      "portable-zip:7z:process",
      winResources.sevenZipExe,
      ["a", "-tzip", "-mx=5", paths.setupZipPath, ".\\*"],
      {
        cwd: builtApp.unpackedRoot,
        outputPath: paths.setupZipPath,
      },
    );
  });
  // Inject the portable flag zip-only. Patch a staging copy of the config and
  // replace the archive entry with a second `7z a` pass; the shared
  // win-unpacked tree (also consumed by the NSIS installer) stays untouched.
  await runSegment("portable-zip:portable-flag", async () => {
    const sourceConfigPath = join(
      builtApp.unpackedRoot,
      "resources",
      "open-design-config.json",
    );
    const stagingRoot = await mkdtemp(join(dirname(paths.setupZipPath), "portable-config-"));
    try {
      const stagedConfigPath = join(stagingRoot, "resources", "open-design-config.json");
      await mkdir(dirname(stagedConfigPath), { recursive: true });
      await writeFile(
        stagedConfigPath,
        withPortableConfigFlag(await readFile(sourceConfigPath, "utf8")),
        "utf8",
      );
      await runExecSegment(
        "portable-zip:portable-flag:process",
        winResources.sevenZipExe,
        ["a", "-tzip", paths.setupZipPath, PACKAGED_CONFIG_ARCHIVE_RELATIVE_PATH],
        {
          cwd: stagingRoot,
          outputPath: paths.setupZipPath,
        },
      );
    } finally {
      await removeTree(stagingRoot);
    }
  });
  await runSegment("portable-zip:stat", async () => {
    await stat(paths.setupZipPath);
  });
  return timings;
}
