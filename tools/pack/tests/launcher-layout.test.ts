import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { ToolPackConfig } from "../src/config.js";
import {
  buildInitialLauncherRuntimeDescriptor,
  resolveToolPackLauncherChannel,
  resolveToolPackLauncherLayout,
  resolveToolPackLauncherPayloadLayout,
} from "../src/launcher-layout.js";
import { resolveWinPaths } from "../src/win/paths.js";

const TEST_WORKSPACE_ROOT = resolve("/work");

function makeConfig(root: string, namespace: string, appVersion?: string): ToolPackConfig {
  return {
    ...(appVersion == null ? {} : { appVersion }),
    electronBuilderCliPath: "/x/electron-builder/cli.js",
    electronDistPath: "/x/electron/dist",
    electronVersion: "41.3.0",
    namespace,
    platform: "win",
    portable: false,
    removeData: false,
    removeLogs: false,
    removeProductUserData: false,
    removeSidecars: false,
    requireVelaCli: false,
    roots: {
      cacheRoot: join(root, ".tmp", "tools-pack", "cache"),
      output: {
        appBuilderRoot: join(root, ".tmp", "tools-pack", "out", "win", "namespaces", namespace, "builder"),
        namespaceRoot: join(root, ".tmp", "tools-pack", "out", "win", "namespaces", namespace),
        platformRoot: join(root, ".tmp", "tools-pack", "out", "win"),
        root: join(root, ".tmp", "tools-pack", "out"),
      },
      runtime: {
        namespaceBaseRoot: join(root, ".tmp", "tools-pack", "runtime", "win", "namespaces"),
        namespaceRoot: join(root, ".tmp", "tools-pack", "runtime", "win", "namespaces", namespace),
      },
      toolPackRoot: join(root, ".tmp", "tools-pack"),
    },
    signed: false,
    silent: true,
    to: "zip",
    webOutputMode: "standalone",
    workspaceRoot: root,
  };
}

describe("tools-pack launcher layout", () => {
  it("derives the update channel from app version before namespace", () => {
    expect(resolveToolPackLauncherChannel(makeConfig(TEST_WORKSPACE_ROOT, "release-beta-win", "0.8.1-preview.1"))).toBe("preview");
    expect(resolveToolPackLauncherChannel(makeConfig(TEST_WORKSPACE_ROOT, "release-beta-win", "0.8.1-beta.2"))).toBe("beta");
    expect(resolveToolPackLauncherChannel(makeConfig(TEST_WORKSPACE_ROOT, "default", "0.8.1"))).toBe("stable");
    expect(resolveToolPackLauncherChannel(makeConfig(TEST_WORKSPACE_ROOT, "release-nightly-win"))).toBe("nightly");
  });

  it("uses the channel root above namespaces for launcher state", () => {
    const config = makeConfig(TEST_WORKSPACE_ROOT, "release-beta-win", "0.8.1-beta.2");
    const layout = resolveToolPackLauncherLayout(config);
    const channelRoot = dirname(config.roots.runtime.namespaceBaseRoot);

    expect(layout.root).toBe(channelRoot);
    expect(layout.paths.namespaceRoot).toBe(
      join(channelRoot, "launcher", "channels", "beta", "namespaces", "release-beta-win"),
    );
    expect(layout.paths.runtimePath).toBe(join(layout.paths.namespaceRoot, "runtime.json"));
    expect(layout.paths.versionsRoot).toBe(join(layout.paths.namespaceRoot, "versions"));
  });

  it("resolves the Windows payload archive and extraction paths", () => {
    const config = makeConfig(TEST_WORKSPACE_ROOT, "release-beta-win", "0.8.1-beta.2");
    const payload = resolveToolPackLauncherPayloadLayout(config, "0.8.1-beta.2");

    expect(payload.archivePath).toBe(join(config.roots.output.namespaceRoot, "payload", "Open Design-release-beta-win-payload.7z"));
    expect(payload.payloadRoot).toBe(join(payload.versionRoot, "payload"));
    expect(payload.archiveRootName).toBe("payload-0.8.1-beta.2");
  });

  it("exposes a stable Windows portable ZIP path", () => {
    const config = makeConfig(TEST_WORKSPACE_ROOT, "release-beta-win", "0.8.1-beta.2");
    const paths = resolveWinPaths(config);

    expect(paths.setupZipPath).toBe(join(config.roots.output.namespaceRoot, "builder", "Open Design-release-beta-win-portable.zip"));
  });

  it("builds the initial runtime descriptor for the first launcher-capable version", () => {
    const config = makeConfig(TEST_WORKSPACE_ROOT, "release-beta-win", "0.8.1-beta.2");

    expect(buildInitialLauncherRuntimeDescriptor(config, "0.8.1-beta.2")).toEqual({
      active: { generation: 0, version: "0.8.1-beta.2" },
      channel: "beta",
      lastSuccessful: { generation: 0, version: "0.8.1-beta.2" },
      namespace: "release-beta-win",
      schemaVersion: 1,
    });
  });

  it("rejects unsafe payload version segments through launcher-proto", () => {
    const config = makeConfig(TEST_WORKSPACE_ROOT, "release-beta-win", "0.8.1-beta.2");
    expect(() => resolveToolPackLauncherPayloadLayout(config, "../0.8.1-beta.2")).toThrow(/path separators/);
  });
});
