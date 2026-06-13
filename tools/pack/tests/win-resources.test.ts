import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ToolPackCache } from "../src/cache.js";
import type { ToolPackConfig } from "../src/config.js";
import { prepareResourceTree } from "../src/win/resources.js";
import type { WinPaths } from "../src/win/types.js";

async function createWorkspaceFixture(workspaceRoot: string): Promise<void> {
  await mkdir(join(workspaceRoot, "skills", "sample"), { recursive: true });
  await mkdir(join(workspaceRoot, "design-templates", "orbit-general"), {
    recursive: true,
  });
  await mkdir(join(workspaceRoot, "design-systems", "sample"), {
    recursive: true,
  });
  await mkdir(join(workspaceRoot, "craft", "sample"), { recursive: true });
  await mkdir(join(workspaceRoot, "plugins", "_official", "sample"), {
    recursive: true,
  });
  await writeFile(
    join(workspaceRoot, "plugins", "_official", "sample", "open-design.json"),
    "{\"id\":\"sample\"}\n",
    "utf8",
  );
  await mkdir(join(workspaceRoot, "plugins", "registry", "community"), {
    recursive: true,
  });
  await writeFile(
    join(workspaceRoot, "plugins", "registry", "community", "open-design-marketplace.json"),
    "{\"plugins\":[]}\n",
    "utf8",
  );
  await mkdir(join(workspaceRoot, "assets", "frames"), { recursive: true });
  await mkdir(join(workspaceRoot, "assets", "community-pets", "sample"), {
    recursive: true,
  });
  await mkdir(join(workspaceRoot, "prompt-templates", "image"), {
    recursive: true,
  });
  await mkdir(join(workspaceRoot, "data", "plugin-previews"), {
    recursive: true,
  });
  await writeFile(
    join(workspaceRoot, "data", "plugin-previews", "manifest.json"),
    "{\"previews\":{}}\n",
    "utf8",
  );
  await mkdir(join(workspaceRoot, "plugins", "registry", "official"), {
    recursive: true,
  });
}

describe("prepareResourceTree", () => {
  it("invalidates the Windows resource tree cache when design templates change", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-win-resources-"));
    const workspaceRoot = join(root, "workspace");
    const resourceRoot = join(root, "materialized", "open-design");
    const cache = new ToolPackCache(join(root, "cache"));
    const config = { workspaceRoot } as ToolPackConfig;
    const paths = { resourceRoot } as WinPaths;
    const templatePath = join(
      workspaceRoot,
      "design-templates",
      "orbit-general",
      "SKILL.md",
    );
    const materializedTemplatePath = join(
      resourceRoot,
      "design-templates",
      "orbit-general",
      "SKILL.md",
    );

    try {
      await createWorkspaceFixture(workspaceRoot);
      await writeFile(templatePath, "version one\n", "utf8");

      await prepareResourceTree(config, paths, cache, { materialize: true });

      await expect(readFile(materializedTemplatePath, "utf8")).resolves.toBe(
        "version one\n",
      );

      await writeFile(templatePath, "version two\n", "utf8");

      await prepareResourceTree(config, paths, cache, { materialize: true });

      await expect(readFile(materializedTemplatePath, "utf8")).resolves.toBe(
        "version two\n",
      );
      expect(cache.report().entries.map((entry) => entry.status)).toEqual([
        "miss",
        "miss",
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("invalidates the Windows resource tree cache when the plugin-preview manifest changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-win-previews-"));
    const workspaceRoot = join(root, "workspace");
    const resourceRoot = join(root, "materialized", "open-design");
    const cache = new ToolPackCache(join(root, "cache"));
    const config = { workspaceRoot } as ToolPackConfig;
    const paths = { resourceRoot } as WinPaths;
    const manifestPath = join(
      workspaceRoot,
      "data",
      "plugin-previews",
      "manifest.json",
    );
    const materializedManifestPath = join(
      resourceRoot,
      "data",
      "plugin-previews",
      "manifest.json",
    );

    try {
      await createWorkspaceFixture(workspaceRoot);
      await writeFile(manifestPath, "{\"previews\":{\"a\":1}}\n", "utf8");

      await prepareResourceTree(config, paths, cache, { materialize: true });

      await expect(readFile(materializedManifestPath, "utf8")).resolves.toBe(
        "{\"previews\":{\"a\":1}}\n",
      );

      await writeFile(manifestPath, "{\"previews\":{\"a\":2}}\n", "utf8");

      await prepareResourceTree(config, paths, cache, { materialize: true });

      await expect(readFile(materializedManifestPath, "utf8")).resolves.toBe(
        "{\"previews\":{\"a\":2}}\n",
      );
      expect(cache.report().entries.map((entry) => entry.status)).toEqual([
        "miss",
        "miss",
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("never copies the vela CLI into the Windows resource tree (AMR removed)", async () => {
    // Corporate fork: resolveOptionalVelaCliBinary returns null unconditionally,
    // so no vela binary is ever written, even when OPEN_DESIGN_VELA_CLI_BIN is set.
    const root = await mkdtemp(join(tmpdir(), "open-design-win-vela-"));
    const workspaceRoot = join(root, "workspace");
    const resourceRoot = join(root, "materialized", "open-design");
    const source = join(root, "source", "vela.exe");
    const cache = new ToolPackCache(join(root, "cache"));
    const config = { workspaceRoot } as ToolPackConfig;
    const paths = { resourceRoot } as WinPaths;
    const originalVelaBin = process.env.OPEN_DESIGN_VELA_CLI_BIN;

    try {
      await createWorkspaceFixture(workspaceRoot);
      await mkdir(join(root, "source"), { recursive: true });
      await writeFile(source, "fake vela exe\n", "utf8");
      process.env.OPEN_DESIGN_VELA_CLI_BIN = source;

      await prepareResourceTree(config, paths, cache, { materialize: true });

      // vela.exe must NOT be present — vela bundling is disabled in this fork
      await expect(readFile(join(resourceRoot, "bin", "vela.exe"), "utf8")).rejects.toThrow();
      await expect(
        readFile(join(resourceRoot, "bin", "libexec", "opencode", "opencode"), "utf8"),
      ).rejects.toThrow();
    } finally {
      if (originalVelaBin == null) delete process.env.OPEN_DESIGN_VELA_CLI_BIN;
      else process.env.OPEN_DESIGN_VELA_CLI_BIN = originalVelaBin;
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does not throw even with requireVelaCli=true (AMR removed — no-op)", async () => {
    // Corporate fork: resolveOptionalVelaCliBinary returns null, so --require-vela-cli
    // no longer hard-fails; it simply bundles nothing.
    const root = await mkdtemp(join(tmpdir(), "open-design-win-vela-strict-"));
    const workspaceRoot = join(root, "workspace");
    const resourceRoot = join(root, "materialized", "open-design");
    const cache = new ToolPackCache(join(root, "cache"));
    const config = {
      workspaceRoot,
      requireVelaCli: true,
    } as ToolPackConfig;
    const paths = { resourceRoot } as WinPaths;
    const originalVelaBin = process.env.OPEN_DESIGN_VELA_CLI_BIN;

    try {
      await createWorkspaceFixture(workspaceRoot);
      process.env.OPEN_DESIGN_VELA_CLI_BIN = join(root, "missing", "vela.exe");
      // Must NOT throw — resolver returns null before checking the path
      await expect(
        prepareResourceTree(config, paths, cache, { materialize: true }),
      ).resolves.not.toThrow();
    } finally {
      if (originalVelaBin == null) delete process.env.OPEN_DESIGN_VELA_CLI_BIN;
      else process.env.OPEN_DESIGN_VELA_CLI_BIN = originalVelaBin;
      await rm(root, { force: true, recursive: true });
    }
  });
});
