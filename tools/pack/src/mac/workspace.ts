import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ToolPackCache } from "../cache.js";
import type { ToolPackConfig } from "../config.js";
import { processWebSourcemaps } from "../web-sourcemaps.js";
import { ensureWorkspaceBuildArtifacts } from "../workspace-build.js";
import { runPnpm } from "./commands.js";

async function buildWorkspaceArtifacts(config: ToolPackConfig): Promise<void> {
  const webNextEnvPath = join(config.workspaceRoot, "apps", "web", "next-env.d.ts");
  const previousWebNextEnv = await readFile(webNextEnvPath, "utf8").catch(() => null);

  await runPnpm(config, ["--filter", "@readable-studio/contracts", "build"]);
  await runPnpm(config, ["--filter", "@readable-studio/registry-protocol", "build"]);
  await runPnpm(config, ["--filter", "@readable-studio/sidecar-proto", "build"]);
  await runPnpm(config, ["--filter", "@readable-studio/launcher-proto", "build"]);
  await runPnpm(config, ["--filter", "@readable-studio/sidecar", "build"]);
  await runPnpm(config, ["--filter", "@readable-studio/platform", "build"]);
  await runPnpm(config, ["--filter", "@readable-studio/agui-adapter", "build"]);
  await runPnpm(config, ["--filter", "@readable-studio/plugin-runtime", "build"]);
  await runPnpm(config, ["--filter", "@readable-studio/download", "build"]);
  await runPnpm(config, ["--filter", "@readable-studio/host", "build"]);
  await runPnpm(config, ["--filter", "@readable-studio/diagnostics", "build"]);
  await runPnpm(config, ["--filter", "@readable-studio/components", "build"]);
  await runPnpm(config, ["--filter", "@readable-studio/daemon", "build"]);
  try {
    await runPnpm(config, ["--filter", "@readable-studio/web", "build"], {
      OD_WEB_OUTPUT_MODE: config.webOutputMode,
    });
    await runPnpm(config, ["--filter", "@readable-studio/web", "build:sidecar"]);
    // Strip browser sourcemaps before any packaging step copies the web
    // output into the Electron resources.
    await processWebSourcemaps(config);
  } finally {
    if (previousWebNextEnv == null) {
      await rm(webNextEnvPath, { force: true });
    } else {
      await writeFile(webNextEnvPath, previousWebNextEnv, "utf8");
    }
  }
  await runPnpm(config, ["--filter", "@readable-studio/desktop", "build"]);
  await runPnpm(config, ["--filter", "@readable-studio/packaged", "build"]);
}

export async function ensureMacWorkspaceBuild(config: ToolPackConfig, cache: ToolPackCache): Promise<void> {
  await ensureWorkspaceBuildArtifacts(config, cache, async () => {
    await buildWorkspaceArtifacts(config);
  });
}
