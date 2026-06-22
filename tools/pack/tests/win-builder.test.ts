import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NtExecutable, NtExecutableResource, Resource } from "resedit";
import { describe, expect, it } from "vitest";

import { hashJson, ToolPackCache, type CacheNode } from "../src/cache.js";
import type { ToolPackConfig } from "../src/config.js";
import {
  buildWinPortableZipCacheKeyInput,
  materializeCachedPurePortableZip,
  materializeCachedUnpackedForInstaller,
} from "../src/win/builder.js";
import { withPortableConfigFlag } from "../src/win/zip.js";
import type { WinPaths } from "../src/win/types.js";
import { readWinExecutableVersionSnapshot } from "../src/win/version-resource.js";

function createPaths(root: string): WinPaths {
  const namespaceRoot = join(root, "namespaces", "second");
  return {
    appBuilderConfigPath: join(namespaceRoot, "builder-config.json"),
    appBuilderOutputRoot: join(namespaceRoot, "builder"),
    assembledAppRoot: join(namespaceRoot, "assembled", "app"),
    assembledMainEntryPath: join(namespaceRoot, "assembled", "app", "main.cjs"),
    assembledPackageJsonPath: join(namespaceRoot, "assembled", "app", "package.json"),
    assembledPrebundledRoot: join(namespaceRoot, "assembled", "app", "prebundled"),
    blockmapPath: join(namespaceRoot, "builder", "Open Design-second-setup.exe.blockmap"),
    builtManifestPath: join(namespaceRoot, "built-app.json"),
    daemonCliPrebundleEntrypointPath: join(namespaceRoot, "prebundle-entrypoints", "daemon-cli.js"),
    daemonCliPrebundlePath: join(namespaceRoot, "assembled", "app", "prebundled", "daemon", "daemon-cli.mjs"),
    daemonPrebundleMetaPath: join(namespaceRoot, "prebundle-meta", "daemon.meta.json"),
    daemonPrebundleRoot: join(namespaceRoot, "assembled", "app", "prebundled", "daemon"),
    daemonSidecarPrebundleEntrypointPath: join(namespaceRoot, "prebundle-entrypoints", "daemon-sidecar.js"),
    daemonSidecarPrebundlePath: join(namespaceRoot, "assembled", "app", "prebundled", "daemon", "daemon-sidecar.mjs"),
    exePath: join(namespaceRoot, "builder", "Open Design-second.exe"),
    installDir: join(namespaceRoot, "runtime", "install", "Open Design"),
    installedExePath: join(namespaceRoot, "runtime", "install", "Open Design", "Open Design.exe"),
    installerBasePayloadPath: join(namespaceRoot, "installer", "payload-base.7z"),
    installerOverlayPayloadPath: join(namespaceRoot, "installer", "payload-overlay.7z"),
    installerScriptPath: join(namespaceRoot, "installer", "installer.nsi"),
    launcherPayloadPath: join(namespaceRoot, "payload", "Open Design-second-payload.7z"),
    publicDesktopShortcutPath: join(namespaceRoot, "desktop", "public.lnk"),
    latestYmlPath: join(namespaceRoot, "builder", "latest.yml"),
    installMarkerPath: join(namespaceRoot, "logs", "install.marker.json"),
    installTimingPath: join(namespaceRoot, "logs", "install.timing.json"),
    nsisLogPath: join(namespaceRoot, "logs", "nsis.log"),
    nsisIncludePath: join(namespaceRoot, "nsis", "installer.nsh"),
    packagedConfigPath: join(namespaceRoot, "open-design-config.json"),
    packagedMainPrebundleMetaPath: join(namespaceRoot, "prebundle-meta", "packaged-main.meta.json"),
    packagedMainPrebundlePath: join(namespaceRoot, "assembled", "app", "prebundled", "packaged-main.mjs"),
    resourceRoot: join(namespaceRoot, "resources", "open-design"),
    setupPath: join(namespaceRoot, "builder", "Open Design-second-setup.exe"),
    setupZipPath: join(namespaceRoot, "builder", "Open Design-second-portable.zip"),
    startMenuShortcutPath: join(namespaceRoot, "start-menu.lnk"),
    tarballsRoot: join(namespaceRoot, "tarballs"),
    userDesktopShortcutPath: join(namespaceRoot, "desktop", "user.lnk"),
    uninstallMarkerPath: join(namespaceRoot, "logs", "uninstall.marker.json"),
    uninstallTimingPath: join(namespaceRoot, "logs", "uninstall.timing.json"),
    uninstallerPath: join(namespaceRoot, "runtime", "install", "Open Design", "Uninstall.exe"),
    webStandaloneHookAuditPath: join(namespaceRoot, "web-standalone-after-pack-audit.json"),
    webStandaloneHookConfigPath: join(namespaceRoot, "web-standalone-after-pack-config.json"),
    webSidecarPrebundleMetaPath: join(namespaceRoot, "prebundle-meta", "web-sidecar.meta.json"),
    webSidecarPrebundlePath: join(namespaceRoot, "assembled", "app", "prebundled", "web-sidecar.mjs"),
    winIconPath: join(namespaceRoot, "resources", "win", "icon.ico"),
    unpackedExePath: join(namespaceRoot, "builder", "win-unpacked", "Open Design.exe"),
    unpackedRoot: join(namespaceRoot, "builder", "win-unpacked"),
  };
}

describe("materializeCachedUnpackedForInstaller", () => {
  it("overwrites cached packaged config and app package version", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-win-builder-"));
    const cachedUnpackedRoot = join(root, "cache", "builder", "win-unpacked");
    const paths = createPaths(root);

    try {
      await mkdir(join(cachedUnpackedRoot, "resources"), { recursive: true });
      await writeFile(join(cachedUnpackedRoot, "Open Design.exe"), await createVersionedExecutable("0.5.0-beta.1"));
      await writeFile(
        join(cachedUnpackedRoot, "resources", "open-design-config.json"),
        `${JSON.stringify({ namespace: "first", version: 1 })}\n`,
        "utf8",
      );
      await mkdir(join(cachedUnpackedRoot, "resources", "app"), { recursive: true });
      await writeFile(
        join(cachedUnpackedRoot, "resources", "app", "package.json"),
        `${JSON.stringify({ name: "open-design-packaged-app", version: "0.5.0-beta.1" })}\n`,
        "utf8",
      );
      await mkdir(join(paths.packagedConfigPath, ".."), { recursive: true });
      await writeFile(
        paths.packagedConfigPath,
        `${JSON.stringify({ appVersion: "0.5.0-beta.2", namespace: "second", version: 1 })}\n`,
        "utf8",
      );

      const manifest = await materializeCachedUnpackedForInstaller(cachedUnpackedRoot, paths, "0.5.0-beta.2");

      expect(manifest.source).toBe("namespace");
      expect(manifest.unpackedRoot).toBe(paths.unpackedRoot);
      await expect(readFile(join(paths.unpackedRoot, "resources", "open-design-config.json"), "utf8")).resolves.toContain(
        '"namespace":"second"',
      );
      await expect(readFile(join(paths.unpackedRoot, "resources", "app", "package.json"), "utf8")).resolves.toContain(
        '"version": "0.5.0-beta.2"',
      );
      await expect(readFile(join(paths.unpackedRoot, "resources", "open-design-config.json"), "utf8")).resolves.toContain(
        '"appVersion":"0.5.0-beta.2"',
      );
      await expect(readWinExecutableVersionSnapshot(join(paths.unpackedRoot, "Open Design.exe"))).resolves.toMatchObject({
        fixedFileVersion: "0.5.0.0",
        fixedProductVersion: "0.5.0.0",
        stringTables: [
          {
            values: expect.objectContaining({
              FileVersion: "0.5.0-beta.2",
              ProductVersion: "0.5.0.0",
            }),
          },
        ],
      });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

describe("materializeCachedPurePortableZip", () => {
  it("copies a cached portable zip without materializing win-unpacked", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-design-win-builder-zip-hit-"));
    const paths = createPaths(root);
    const cache = new ToolPackCache(join(root, "cache"));
    const packagedConfig = `${JSON.stringify({ appVersion: "0.5.0-beta.2", namespace: "second" }, null, 2)}\n`;
    const electronBuilderDirKey = "dir-key";
    const packagedAppKey = "app-key";
    const packagedVersion = "0.5.0-beta.2";
    const signingCacheKey = null;

    try {
      await mkdir(join(paths.packagedConfigPath, ".."), { recursive: true });
      await writeFile(paths.packagedConfigPath, packagedConfig, "utf8");
    const portableZipNode: CacheNode<{ createdAt: string; portableZipPath: string }> = {
      build: async ({ entryRoot }) => {
        await writeFile(join(entryRoot, "portable.zip"), "cached zip bytes", "utf8");
        return { createdAt: "2026-06-17T00:00:00.000Z", portableZipPath: "cache" };
      },
        id: "win.portable-zip",
        invalidate: async () => null,
        key: hashJson(
          buildWinPortableZipCacheKeyInput({
            electronBuilderDirKey,
            injectedPackagedConfig: withPortableConfigFlag(packagedConfig),
            namespace: "second",
            packagedAppKey,
            packagedVersion,
            portableZipCompression: 5,
            signing: signingCacheKey,
          }),
        ),
        outputs: ["portable.zip"],
      };
      await cache.acquire({ materialize: [], node: portableZipNode });

      const hit = await materializeCachedPurePortableZip({
        cache,
        config: { namespace: "second", portable: true, signed: false, to: "zip" } as ToolPackConfig,
        electronBuilderDirKey,
        packagedAppKey,
        packagedVersion,
        paths,
        signingCacheKey,
      });

      expect(hit).toBe(true);
      await expect(readFile(paths.setupZipPath, "utf8")).resolves.toBe("cached zip bytes");
      expect(cache.report().entries.at(-1)).toMatchObject({
        materialized: [{ from: "portable.zip", to: paths.setupZipPath }],
        nodeId: "win.portable-zip",
        status: "hit",
      });
      expect(cache.report().entries.some((entry) => entry.nodeId === "win.electron-builder-dir" && entry.materialized.length > 0)).toBe(
        false,
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("changes the portable zip cache key when compression changes", () => {
    const base = {
      electronBuilderDirKey: "dir-key",
      injectedPackagedConfig: `${JSON.stringify({ namespace: "second", portable: true }, null, 2)}\n`,
      namespace: "second",
      packagedAppKey: "app-key",
      packagedVersion: "0.5.0-beta.2",
      portableZipCompression: 5,
      signing: null,
    };

    const defaultCompressionKey = hashJson(buildWinPortableZipCacheKeyInput(base));
    const fastCompressionKey = hashJson(buildWinPortableZipCacheKeyInput({ ...base, portableZipCompression: 1 }));

    expect(fastCompressionKey).not.toBe(defaultCompressionKey);
  });
});

async function createVersionedExecutable(packagedVersion: string): Promise<Buffer> {
  const executable = NtExecutable.createEmpty(false, false);
  const resource = NtExecutableResource.from(executable);
  const version = Resource.VersionInfo.createEmpty();
  version.lang = 1033;
  version.setFileVersion("0.5.0.0", 1033);
  version.setProductVersion("0.5.0.0", 1033);
  version.setStringValues(
    { codepage: 1200, lang: 1033 },
    {
      FileDescription: "Open Design",
      FileVersion: packagedVersion,
      ProductName: "Open Design",
      ProductVersion: "0.5.0.0",
    },
  );
  version.outputToResourceEntries(resource.entries);
  resource.outputResource(executable);
  return Buffer.from(executable.generate());
}
