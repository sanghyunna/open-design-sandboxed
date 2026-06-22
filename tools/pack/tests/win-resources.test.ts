import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ToolPackCache } from "../src/cache.js";
import type { ToolPackConfig } from "../src/config.js";
import { shouldMaterializeWinResourceTree } from "../src/win/build.js";
import { prepareResourceTree } from "../src/win/resources.js";
import type { WinPaths } from "../src/win/types.js";

function stubExecPath(execPath: string): () => void {
  const previous = process.execPath;
  Object.defineProperty(process, "execPath", { value: execPath, configurable: true });
  return () => {
    Object.defineProperty(process, "execPath", { value: previous, configurable: true });
  };
}

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
  await mkdir(join(workspaceRoot, "assets", "community-pets", "clippit"), {
    recursive: true,
  });
  await mkdir(join(workspaceRoot, "assets", "community-pets", "dario"), { recursive: true });
  await writeFile(join(workspaceRoot, "assets", "community-pets", "clippit", "pet.json"), "{\"name\":\"clippit\"}\n", "utf8");
  await writeFile(join(workspaceRoot, "assets", "community-pets", "clippit", "spritesheet.webp"), "clippit-sheet\n", "utf8");
  await writeFile(join(workspaceRoot, "assets", "community-pets", "dario", "pet.json"), "{\"name\":\"dario\"}\n", "utf8");
  await writeFile(join(workspaceRoot, "assets", "community-pets", "dario", "spritesheet.webp"), "dario-sheet\n", "utf8");
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
  it("keeps pure portable zip resource packaging on the cache tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-win-resources-cache-"));
    const workspaceRoot = join(root, "workspace");
    const resourceRoot = join(root, "materialized", "open-design");
    const cache = new ToolPackCache(join(root, "cache"));
    const config = {
      portable: true,
      to: "zip",
      workspaceRoot,
    } as ToolPackConfig;
    const paths = { resourceRoot } as WinPaths;
    const templatePath = join(
      workspaceRoot,
      "design-templates",
      "orbit-general",
      "SKILL.md",
    );

    try {
      await createWorkspaceFixture(workspaceRoot);
      await writeFile(templatePath, "portable resource\n", "utf8");

      await prepareResourceTree({ ...config, portable: false }, paths, cache, { materialize: true });

      const result = await prepareResourceTree(config, paths, cache, {
        materialize: shouldMaterializeWinResourceTree(config),
      });

      expect(result.resourceRoot).not.toBe(resourceRoot);
      await expect(
        readFile(join(result.resourceRoot, "design-templates", "orbit-general", "SKILL.md"), "utf8"),
      ).resolves.toBe("portable resource\n");
      await expect(
        readFile(join(result.resourceRoot, "community-pets", "clippit", "pet.json"), "utf8"),
      ).resolves.toBe("{\"name\":\"clippit\"}\n");
      await expect(
        readFile(join(result.resourceRoot, "community-pets", "dario", "pet.json"), "utf8"),
      ).resolves.toBe("{\"name\":\"dario\"}\n");
      await expect(access(join(result.resourceRoot, "bin", "node.exe"))).resolves.toBeUndefined();
      expect(cache.report().entries.at(-1)?.materialized).toEqual([]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("only skips namespace resource materialization for pure portable zip", () => {
    expect(shouldMaterializeWinResourceTree({ portable: true, to: "zip" } as ToolPackConfig)).toBe(false);
    expect(shouldMaterializeWinResourceTree({ portable: false, to: "zip" } as ToolPackConfig)).toBe(true);
    expect(shouldMaterializeWinResourceTree({ portable: true, to: "all" } as ToolPackConfig)).toBe(true);
    expect(shouldMaterializeWinResourceTree({ portable: true, to: "nsis" } as ToolPackConfig)).toBe(true);
    expect(shouldMaterializeWinResourceTree({ portable: true, to: "dir" } as ToolPackConfig)).toBe(false);
  });

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

  it("materializes a bundled node.exe copied from process.execPath", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-win-node-"));
    const workspaceRoot = join(root, "workspace");
    const resourceRoot = join(root, "materialized", "open-design");
    const sourceRoot = join(root, "source");
    const nodePath = join(sourceRoot, "node.exe");
    const cache = new ToolPackCache(join(root, "cache"));
    const config = { workspaceRoot } as ToolPackConfig;
    const paths = { resourceRoot } as WinPaths;
    let restoreExecPath: () => void = () => undefined;

    try {
      await createWorkspaceFixture(workspaceRoot);
      await mkdir(sourceRoot, { recursive: true });
      await writeFile(nodePath, "fake node binary\n", "utf8");
      restoreExecPath = stubExecPath(nodePath);

      await prepareResourceTree(config, paths, cache, { materialize: true });

      await expect(readFile(join(resourceRoot, "bin", "node.exe"))).resolves.toEqual(
        await readFile(process.execPath),
      );
    } finally {
      restoreExecPath();
      await rm(root, { force: true, recursive: true });
    }
  });

  it("invalidates the Windows resource tree cache when the bundled Node binary changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-win-node-cache-"));
    const workspaceRoot = join(root, "workspace");
    const resourceRoot = join(root, "materialized", "open-design");
    const sourceRoot = join(root, "source");
    const nodePath = join(sourceRoot, "node.exe");
    const cache = new ToolPackCache(join(root, "cache"));
    const config = { workspaceRoot } as ToolPackConfig;
    const paths = { resourceRoot } as WinPaths;
    let restoreExecPath: () => void = () => undefined;

    try {
      await createWorkspaceFixture(workspaceRoot);
      await mkdir(sourceRoot, { recursive: true });
      await writeFile(nodePath, "node binary one\n", "utf8");

      restoreExecPath = stubExecPath(nodePath);
      await prepareResourceTree(config, paths, cache, { materialize: true });
      await expect(readFile(join(resourceRoot, "bin", "node.exe"), "utf8")).resolves.toBe(
        "node binary one\n",
      );

      await writeFile(nodePath, "node binary two\n", "utf8");
      await prepareResourceTree(config, paths, cache, { materialize: true });
      await expect(readFile(join(resourceRoot, "bin", "node.exe"), "utf8")).resolves.toBe(
        "node binary two\n",
      );
      expect(cache.report().entries.map((entry) => entry.status)).toEqual([
        "miss",
        "miss",
      ]);
    } finally {
      restoreExecPath();
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
