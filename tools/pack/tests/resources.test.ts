import { describe, expect, it } from "vitest";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import { copyBundledResourceTrees } from "../src/resources.js";
import { copyOptionalVelaCliBinary, resolveOptionalVelaCliBinary } from "../src/vela-cli.js";

describe("copyBundledResourceTrees", () => {
  it("includes daemon resource trees", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-tools-pack-"));
    const workspaceRoot = join(root, "workspace");
    const resourceRoot = join(root, "resources");

    try {
      const promptTemplatePath = join(
        workspaceRoot,
        "prompt-templates",
        "image",
        "sample.json",
      );
      const designTemplatePath = join(
        workspaceRoot,
        "design-templates",
        "orbit-general",
        "SKILL.md",
      );
      const communityPetPath = join(
        workspaceRoot,
        "assets",
        "community-pets",
        "sample",
        "pet.json",
      );
      const communityRegistryPath = join(
        workspaceRoot,
        "plugins",
        "registry",
        "community",
        "open-design-marketplace.json",
      );
      await mkdir(join(workspaceRoot, "skills", "sample"), { recursive: true });
      // The skills/design-templates split (see specs/current/
      // skills-and-design-templates.md) added a separate top-level
      // `design-templates/` tree that copyBundledResourceTrees now also
      // bundles. Create it in the fixture so the recursive copy does not
      // fail with ENOENT before reaching the prompt-templates assertion.
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
      await mkdir(join(workspaceRoot, "plugins", "registry", "community"), {
        recursive: true,
      });
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
      await writeFile(promptTemplatePath, "{\"id\":\"sample\"}\n", "utf8");
      await writeFile(
        join(workspaceRoot, "data", "plugin-previews", "manifest.json"),
        "{\"previews\":{}}\n",
        "utf8",
      );
      await writeFile(designTemplatePath, "# Orbit General\n", "utf8");
      await writeFile(communityPetPath, "{\"name\":\"sample\"}\n", "utf8");
      await writeFile(
        join(workspaceRoot, "plugins", "_official", "sample", "open-design.json"),
        "{\"id\":\"sample\"}\n",
        "utf8",
      );
      await writeFile(communityRegistryPath, "{\"plugins\":[]}\n", "utf8");

      await copyBundledResourceTrees({ workspaceRoot, resourceRoot });

      await expect(
        readFile(
          join(resourceRoot, "prompt-templates", "image", "sample.json"),
          "utf8",
        ),
      ).resolves.toBe("{\"id\":\"sample\"}\n");
      // The baked plugin-preview manifest must land under data/plugin-previews so
      // the packaged daemon can map plugins to their R2 clips; without it the
      // gallery silently falls back to live iframes.
      await expect(
        readFile(
          join(resourceRoot, "data", "plugin-previews", "manifest.json"),
          "utf8",
        ),
      ).resolves.toBe("{\"previews\":{}}\n");
      await expect(
        readFile(
          join(resourceRoot, "design-templates", "orbit-general", "SKILL.md"),
          "utf8",
        ),
      ).resolves.toBe("# Orbit General\n");
      await expect(
        readFile(
          join(resourceRoot, "community-pets", "sample", "pet.json"),
          "utf8",
        ),
      ).resolves.toBe("{\"name\":\"sample\"}\n");
      await expect(
        readFile(
          join(resourceRoot, "plugins", "_official", "sample", "open-design.json"),
          "utf8",
        ),
      ).resolves.toBe("{\"id\":\"sample\"}\n");
      await expect(
        readFile(
          join(
            resourceRoot,
            "plugins",
            "registry",
            "community",
            "open-design-marketplace.json",
          ),
          "utf8",
        ),
      ).resolves.toBe("{\"plugins\":[]}\n");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

describe("copyOptionalVelaCliBinary", () => {
  // Corporate fork: vela/AMR integration removed. resolveOptionalVelaCliBinary
  // returns null unconditionally, so copyOptionalVelaCliBinary is always a
  // no-op — no vela binary is ever written to resources/bin/.

  it("never copies the vela CLI (resolveOptionalVelaCliBinary returns null unconditionally)", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-tools-pack-vela-never-"));
    const resourceRoot = join(root, "resources", "open-design");
    const platform = process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux";

    try {
      const copied = await copyOptionalVelaCliBinary({
        env: {},
        platform,
        requireBundled: true,
        resourceRoot,
      });

      expect(copied).toBeNull();
      await expect(access(join(resourceRoot, "bin", "vela"))).rejects.toThrow();
      await expect(access(join(resourceRoot, "bin", "vela.exe"))).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("returns null even when OPEN_DESIGN_VELA_CLI_BIN env is set", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-tools-pack-vela-env-"));
    const source = join(root, "source", "vela");
    const resourceRoot = join(root, "resources", "open-design");

    try {
      await mkdir(join(root, "source"), { recursive: true });
      await writeFile(source, "#!/bin/sh\nexit 0\n", "utf8");

      const copied = await copyOptionalVelaCliBinary({
        env: { OPEN_DESIGN_VELA_CLI_BIN: source },
        platform: "mac",
        requireBundled: false,
        resourceRoot,
      });

      expect(copied).toBeNull();
      await expect(access(join(resourceRoot, "bin", "vela"))).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("returns null even with an npm package mock resolver", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-tools-pack-vela-npm-"));
    const source = join(root, "source", "vela");
    const resourceRoot = join(root, "resources", "open-design");

    try {
      await mkdir(join(root, "source"), { recursive: true });
      await writeFile(source, "#!/bin/sh\nexit 0\n", "utf8");

      const copied = await copyOptionalVelaCliBinary({
        env: {},
        importPackage: async () => ({
          resolveVelaCliBin: () => source,
        }),
        platform: "mac",
        requireBundled: true,
        resourceRoot,
      });

      expect(copied).toBeNull();
      await expect(access(join(resourceRoot, "bin", "vela"))).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

describe("resolveOptionalVelaCliBinary", () => {
  // Corporate fork: vela/AMR integration removed. All inputs are ignored and
  // null is returned unconditionally.

  it("returns null regardless of OPEN_DESIGN_VELA_CLI_BIN env", async () => {
    await expect(
      resolveOptionalVelaCliBinary({
        env: { OPEN_DESIGN_VELA_CLI_BIN: "/tmp/local-vela" },
        importPackage: async () => ({
          resolveVelaCliBin: () => "/tmp/npm-vela",
        }),
      }),
    ).resolves.toBeNull();
  });

  it("returns null in strict mode (no throw) when the resolver package is missing", async () => {
    await expect(
      resolveOptionalVelaCliBinary({
        env: {},
        importPackage: async () => {
          throw new Error("not installed");
        },
        requireBundled: true,
      }),
    ).resolves.toBeNull();
  });

  it("returns null in strict mode (no throw) when the resolver returns no binary", async () => {
    await expect(
      resolveOptionalVelaCliBinary({
        env: {},
        importPackage: async () => ({
          resolveVelaCliBin: () => ({ supported: false }),
        }),
        requireBundled: true,
      }),
    ).resolves.toBeNull();
  });

  it("returns null in non-strict mode when the resolver package is missing", async () => {
    await expect(
      resolveOptionalVelaCliBinary({
        env: {},
        importPackage: async () => {
          throw new Error("not installed");
        },
      }),
    ).resolves.toBeNull();
  });
});
