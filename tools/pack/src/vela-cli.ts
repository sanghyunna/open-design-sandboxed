import { chmod, cp, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

export const VELA_CLI_BIN_ENV = "OPEN_DESIGN_VELA_CLI_BIN";
const OPEN_CODE_COMPANION_RELATIVE_PATH = ["libexec", "opencode"] as const;

type VelaCliPlatform = "linux" | "mac" | "win";
type VelaCliResolveResult =
  | string
  | null
  | undefined
  | {
      path?: string | null;
      supported?: boolean;
    };
type VelaCliResolverModule = {
  resolveVelaCliBin?: (
    options?: { strict?: boolean },
  ) => VelaCliResolveResult | Promise<VelaCliResolveResult>;
};

function strictResolutionError(message: string, cause?: unknown): Error {
  return new Error(
    `${message}; install @powerformer/vela-cli through pnpm install or set ${VELA_CLI_BIN_ENV}`,
    cause === undefined ? undefined : { cause },
  );
}

function targetBinaryName(platform: VelaCliPlatform): string {
  return platform === "win" ? "vela.exe" : "vela";
}

export async function copyOptionalVelaCliBinary({
  env = process.env,
  importPackage,
  platform,
  requireBundled = false,
  resourceRoot,
}: {
  env?: NodeJS.ProcessEnv;
  importPackage?: (packageName: string) => Promise<VelaCliResolverModule>;
  platform: VelaCliPlatform;
  requireBundled?: boolean;
  resourceRoot: string;
}): Promise<{ source: string; target: string } | null> {
  const source = await resolveOptionalVelaCliBinary({ env, importPackage, requireBundled });
  if (source == null) return null;
  const target = join(resourceRoot, "bin", targetBinaryName(platform));
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target);
  await copyBundledOpenCodeTree({ requireBundled, resourceRoot, source });
  if (platform !== "win") {
    await chmod(target, 0o755);
  }
  return { source, target };
}

export function resolveVelaCliOpenCodeCompanionTree(source: string): string {
  return join(dirname(source), ...OPEN_CODE_COMPANION_RELATIVE_PATH);
}

export async function resolveOptionalVelaCliOpenCodeCompanionTree(
  source: string,
): Promise<string | null> {
  const sourceTree = resolveVelaCliOpenCodeCompanionTree(source);
  return (await isDirectory(sourceTree)) ? sourceTree : null;
}

async function copyBundledOpenCodeTree({
  requireBundled,
  resourceRoot,
  source,
}: {
  requireBundled: boolean;
  resourceRoot: string;
  source: string;
}): Promise<void> {
  const sourceTree = resolveVelaCliOpenCodeCompanionTree(source);
  const targetTree = join(resourceRoot, "bin", ...OPEN_CODE_COMPANION_RELATIVE_PATH);
  if (!(await isDirectory(sourceTree))) {
    if (requireBundled) {
      throw strictResolutionError(
        `unable to resolve bundled Vela CLI: OpenCode companion directory is missing at ${sourceTree}`,
      );
    }
    return;
  }
  await cp(sourceTree, targetTree, { force: true, recursive: true });
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Corporate fork: the AMR/vela integration has been removed from this
 * repository.  Returning null here unconditionally makes
 * `copyOptionalVelaCliBinary` a no-op (it early-returns when source is null)
 * and causes the win/mac/linux resource cache-key hashing to see no vela
 * binary, so the vela CLI is never written into resources/bin/.
 *
 * The function signature and all downstream exports are preserved so that
 * callers in win/resources.ts, mac/app.ts, and linux.ts continue to compile
 * unchanged — they all already handle a null result gracefully.
 *
 * Note: with this change, `--require-vela-cli` no longer hard-fails; it simply
 * bundles nothing.  That is acceptable for this fork because the AMR cloud
 * feature has been intentionally removed.
 */
export async function resolveOptionalVelaCliBinary({}: {
  env?: NodeJS.ProcessEnv;
  importPackage?: (packageName: string) => Promise<VelaCliResolverModule>;
  requireBundled?: boolean;
} = {}): Promise<string | null> {
  return null;
}
