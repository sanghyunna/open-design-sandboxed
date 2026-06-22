import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import type { ToolPackConfig } from "../src/config.js";
import { winResources } from "../src/resources.js";
import { buildWinPortableZipCacheKeyInput } from "../src/win/builder.js";
import {
  buildWinPortableZip,
  resolvePortableZipCompression,
  resolveWinPortableZipLocalePruneEntries,
  shouldPruneWinPortableZipLocales,
  WIN_PORTABLE_CHROMIUM_LOCALE_PAKS,
  withPortableConfigFlag,
} from "../src/win/zip.js";
import type { WinBuiltAppManifest, WinPaths } from "../src/win/types.js";

const execFileAsync = promisify(execFile);

describe("withPortableConfigFlag", () => {
  it("sets portable: true on a packaged config", () => {
    const patched = JSON.parse(withPortableConfigFlag(`${JSON.stringify({ namespace: "rg" }, null, 2)}\n`)) as {
      portable?: unknown;
    };
    expect(patched.portable).toBe(true);
  });

  it("round-trips every other field, including unknown ones", () => {
    const original = {
      appVersion: "1.2.3",
      namespace: "rg",
      webOutputMode: "standalone",
      // A field this code does not know about must survive untouched.
      futureField: { nested: [1, 2, 3] },
    };
    const patched = JSON.parse(withPortableConfigFlag(`${JSON.stringify(original, null, 2)}\n`)) as Record<
      string,
      unknown
    >;
    expect(patched).toEqual({ ...original, portable: true });
  });

  it("serializes with the same 2-space indent + trailing newline as writePackagedConfigFile", () => {
    const original = { appVersion: "1.2.3", namespace: "rg" };
    const output = withPortableConfigFlag(`${JSON.stringify(original, null, 2)}\n`);
    // Matches manifest.ts writePackagedConfigFile: JSON.stringify(obj, null, 2) + "\n".
    expect(output).toBe(`${JSON.stringify({ ...original, portable: true }, null, 2)}\n`);
    expect(output.endsWith("\n")).toBe(true);
    expect(output.endsWith("}\n")).toBe(true);
  });

  it("overwrites a pre-existing portable: false rather than appending a duplicate", () => {
    const patched = JSON.parse(
      withPortableConfigFlag(`${JSON.stringify({ namespace: "rg", portable: false }, null, 2)}\n`),
    ) as { portable?: unknown };
    expect(patched.portable).toBe(true);
  });

  it("keys the portable-zip cache on the materialized tree and the exact injected config", () => {
    // The zip's true inputs are the electron-builder dir tree (resourceTreeKey
    // rides its key) and the post-injection config text. Without both in the
    // key, a resource-tree or baked-config-only change (updateMetadataUrl,
    // telemetry fields) could serve a stale cached zip.
    const base = {
      electronBuilderDirKey: "dir-key-1",
      injectedPackagedConfig: '{\n  "namespace": "rg",\n  "portable": true\n}\n',
      namespace: "rg",
      packagedAppKey: "app-key-1",
      packagedVersion: "1.2.3",
      portableZipCompression: 5,
      signing: null,
    };
    const input = buildWinPortableZipCacheKeyInput(base);
    expect(input).toMatchObject({
      electronBuilderDirKey: "dir-key-1",
      injectedPackagedConfig: base.injectedPackagedConfig,
      target: "portable-zip",
    });
    // Mutating either previously-missing input must change the keyed payload.
    expect(
      buildWinPortableZipCacheKeyInput({ ...base, electronBuilderDirKey: "dir-key-2" }),
    ).not.toEqual(input);
    expect(
      buildWinPortableZipCacheKeyInput({
        ...base,
        injectedPackagedConfig: '{\n  "namespace": "rg",\n  "portable": true,\n  "updateMetadataUrl": "https://example.test/latest"\n}\n',
      }),
    ).not.toEqual(input);
    expect(buildWinPortableZipCacheKeyInput({ ...base, portableZipCompression: 1 })).not.toEqual(input);
  });

  it("strips a baked namespaceBaseRoot so the build-machine root cannot defeat the exe-adjacent fallback", () => {
    // Non-`--portable` builds bake the tools-pack runtime root into the shared
    // tree's config; an explicit namespaceBaseRoot wins over the portable
    // fallback at runtime, so the zip's copy must not carry it.
    const original = {
      appVersion: "1.2.3",
      namespace: "rg",
      namespaceBaseRoot: "D:\\repo\\.tmp\\tools-pack\\out\\win\\namespaces\\rg\\runtime\\namespaces",
    };
    const patched = JSON.parse(withPortableConfigFlag(`${JSON.stringify(original, null, 2)}\n`)) as Record<
      string,
      unknown
    >;
    expect(patched).toEqual({ appVersion: "1.2.3", namespace: "rg", portable: true });
    expect("namespaceBaseRoot" in patched).toBe(false);
  });
});

describe("resolvePortableZipCompression", () => {
  it("defaults to release compression when unset", () => {
    expect(resolvePortableZipCompression(undefined)).toBe(5);
  });

  it("accepts local portable overrides within the 7z range", () => {
    expect(resolvePortableZipCompression("1")).toBe(1);
    expect(resolvePortableZipCompression("0")).toBe(0);
  });

  it("rejects compression values outside the 7z range", () => {
    expect(() => resolvePortableZipCompression("10")).toThrow(/must be an integer from 0 to 9/);
    expect(() => resolvePortableZipCompression("fast")).toThrow(/must be an integer from 0 to 9/);
  });
});

describe("Windows portable zip locale pruning", () => {
  it("maps supported app locales to Chromium pak names explicitly", () => {
    expect(WIN_PORTABLE_CHROMIUM_LOCALE_PAKS).toEqual(["en-US.pak", "ko.pak"]);
  });

  it("is guarded to unsigned portable zip-only builds", () => {
    expect(shouldPruneWinPortableZipLocales({ portable: true, signed: false, to: "zip" } as ToolPackConfig)).toBe(true);
    expect(shouldPruneWinPortableZipLocales({ portable: false, signed: false, to: "zip" } as ToolPackConfig)).toBe(false);
    expect(shouldPruneWinPortableZipLocales({ portable: true, signed: false, to: "all" } as ToolPackConfig)).toBe(false);
    expect(shouldPruneWinPortableZipLocales({ portable: true, signed: false, to: "nsis" } as ToolPackConfig)).toBe(false);
    expect(shouldPruneWinPortableZipLocales({ portable: true, signed: true, to: "zip" } as ToolPackConfig)).toBe(false);
  });

  it("selects only unsupported top-level Chromium locale paks", async () => {
    const root = await mkdtemp(join(tmpdir(), "od-tools-pack-locale-prune-"));
    try {
      await mkdir(join(root, "locales"), { recursive: true });
      await writeFile(join(root, "locales", "en-US.pak"), "en", "utf8");
      await writeFile(join(root, "locales", "ko.pak"), "ko", "utf8");
      await writeFile(join(root, "locales", "ja.pak"), "ja", "utf8");
      await writeFile(join(root, "locales", "README.txt"), "keep", "utf8");

      await expect(
        resolveWinPortableZipLocalePruneEntries({
          config: { portable: true, signed: false, to: "zip" } as ToolPackConfig,
          unpackedRoot: root,
        }),
      ).resolves.toEqual(["locales/ja.pak"]);
      await expect(
        resolveWinPortableZipLocalePruneEntries({
          config: { portable: true, signed: false, to: "all" } as ToolPackConfig,
          unpackedRoot: root,
        }),
      ).resolves.toEqual([]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

// Integration: drives the real bundled 7z twice (archive, then the portable
// patch pass) and verifies the second pass replaced the config entry in place
// while leaving the rest of the tree intact. Win32-only and tiny, mirroring the
// existing launcher-payload 7z specs; it completes well under 2s.
describe.skipIf(process.platform !== "win32")("buildWinPortableZip portable injection", () => {
  async function buildPortableZipFixture(compression: string | undefined): Promise<{
    extractedConfig: Record<string, unknown>;
    originalConfig: {
      appVersion: string;
      futureField: number;
      namespace: string;
      namespaceBaseRoot: string;
    };
    extractedAppI18nLocales: string[];
    extractedChromiumLocales: string[];
    timings: Awaited<ReturnType<typeof buildWinPortableZip>>;
  }> {
    const root = await mkdtemp(join(tmpdir(), "od-tools-pack-portable-zip-"));
    const previousCompression = process.env.OD_PORTABLE_ZIP_COMPRESSION;
    if (compression == null) {
      delete process.env.OD_PORTABLE_ZIP_COMPRESSION;
    } else {
      process.env.OD_PORTABLE_ZIP_COMPRESSION = compression;
    }

    try {
      const unpackedRoot = join(root, "win-unpacked");
      await mkdir(join(unpackedRoot, "resources"), { recursive: true });
      // A config WITHOUT a portable flag, WITH an unknown field, and WITH a
      // baked build-machine namespaceBaseRoot — exactly like a non-portable
      // shared unpacked tree's config. The zip copy must gain portable:true
      // and LOSE the baked root (which would otherwise win over the
      // exe-adjacent fallback at runtime).
      const bakedNamespaceBaseRoot = join(root, "fake-tools-pack-runtime", "namespaces");
      const originalConfig = {
        appVersion: "1.2.3",
        futureField: 7,
        namespace: "rg",
        namespaceBaseRoot: bakedNamespaceBaseRoot,
      };
      await writeFile(
        join(unpackedRoot, "resources", "open-design-config.json"),
        `${JSON.stringify(originalConfig, null, 2)}\n`,
        "utf8",
      );
      await writeFile(join(unpackedRoot, "Open Design.exe"), "fake-exe", "utf8");
      await writeFile(join(unpackedRoot, "resources", "app.txt"), "fake-resource", "utf8");
      await mkdir(join(unpackedRoot, "locales"), { recursive: true });
      await writeFile(join(unpackedRoot, "locales", "en-US.pak"), "en", "utf8");
      await writeFile(join(unpackedRoot, "locales", "ko.pak"), "ko", "utf8");
      await writeFile(join(unpackedRoot, "locales", "ja.pak"), "ja", "utf8");
      await mkdir(join(unpackedRoot, "resources", "app", "i18n", "locales"), { recursive: true });
      await writeFile(join(unpackedRoot, "resources", "app", "i18n", "locales", "ja.ts"), "app i18n", "utf8");

      const setupZipPath = join(root, "builder", "Open Design-rg-portable.zip");
      const paths = fakePaths(root, setupZipPath, unpackedRoot);
      const builtApp: WinBuiltAppManifest = {
        appBuilderOutputRoot: paths.appBuilderOutputRoot,
        cacheEntryPath: null,
        configPath: join(unpackedRoot, "resources", "open-design-config.json"),
        executablePath: paths.unpackedExePath,
        source: "namespace",
        unpackedRoot,
        version: 1,
        webStandaloneHookAuditPath: null,
      };

      const timings = await buildWinPortableZip({ portable: true, signed: false, to: "zip" } as ToolPackConfig, paths, builtApp);

      const extractRoot = join(root, "extracted");
      await mkdir(extractRoot, { recursive: true });
      await execFileAsync(winResources.sevenZipExe, ["x", setupZipPath, `-o${extractRoot}`, "-y"]);

      const extractedConfig = JSON.parse(
        await readFile(join(extractRoot, "resources", "open-design-config.json"), "utf8"),
      ) as Record<string, unknown>;
      const extractedChromiumLocales = (await readdir(join(extractRoot, "locales"))).sort();
      const extractedAppI18nLocales = (await readdir(join(extractRoot, "resources", "app", "i18n", "locales"))).sort();

      return { extractedAppI18nLocales, extractedChromiumLocales, extractedConfig, originalConfig, timings };
    } finally {
      if (previousCompression == null) {
        delete process.env.OD_PORTABLE_ZIP_COMPRESSION;
      } else {
        process.env.OD_PORTABLE_ZIP_COMPRESSION = previousCompression;
      }
      await rm(root, { force: true, recursive: true });
    }
  }

  function fakePaths(root: string, setupZipPath: string, unpackedRoot: string): WinPaths {
    // Only the fields buildWinPortableZip reads matter; the rest are filled so
    // the shape stays a real WinPaths without leaking into the assertions.
    const namespaceRoot = join(root, "namespaces", "rg");
    return {
      appBuilderConfigPath: join(namespaceRoot, "builder-config.json"),
      appBuilderOutputRoot: join(namespaceRoot, "builder"),
      assembledAppRoot: join(namespaceRoot, "assembled", "app"),
      assembledMainEntryPath: join(namespaceRoot, "assembled", "app", "main.cjs"),
      assembledPackageJsonPath: join(namespaceRoot, "assembled", "app", "package.json"),
      assembledPrebundledRoot: join(namespaceRoot, "assembled", "app", "prebundled"),
      blockmapPath: join(namespaceRoot, "builder", "Open Design-rg-setup.exe.blockmap"),
      builtManifestPath: join(namespaceRoot, "built-app.json"),
      daemonCliPrebundleEntrypointPath: join(namespaceRoot, "prebundle-entrypoints", "daemon-cli.js"),
      daemonCliPrebundlePath: join(namespaceRoot, "assembled", "app", "prebundled", "daemon", "daemon-cli.mjs"),
      daemonPrebundleMetaPath: join(namespaceRoot, "prebundle-meta", "daemon.meta.json"),
      daemonPrebundleRoot: join(namespaceRoot, "assembled", "app", "prebundled", "daemon"),
      daemonSidecarPrebundleEntrypointPath: join(namespaceRoot, "prebundle-entrypoints", "daemon-sidecar.js"),
      daemonSidecarPrebundlePath: join(namespaceRoot, "assembled", "app", "prebundled", "daemon", "daemon-sidecar.mjs"),
      exePath: join(namespaceRoot, "builder", "Open Design-rg.exe"),
      installDir: join(namespaceRoot, "runtime", "install", "Open Design"),
      installedExePath: join(namespaceRoot, "runtime", "install", "Open Design", "Open Design.exe"),
      installerBasePayloadPath: join(namespaceRoot, "installer", "payload-base.7z"),
      installerOverlayPayloadPath: join(namespaceRoot, "installer", "payload-overlay.7z"),
      installerScriptPath: join(namespaceRoot, "installer", "installer.nsi"),
      launcherPayloadPath: join(namespaceRoot, "payload", "Open Design-rg-payload.7z"),
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
      setupPath: join(namespaceRoot, "builder", "Open Design-rg-setup.exe"),
      setupZipPath,
      startMenuShortcutPath: join(namespaceRoot, "start-menu", "Open Design.lnk"),
      tarballsRoot: join(namespaceRoot, "tarballs"),
      userDesktopShortcutPath: join(namespaceRoot, "desktop", "user.lnk"),
      uninstallMarkerPath: join(namespaceRoot, "logs", "uninstall.marker.json"),
      uninstallTimingPath: join(namespaceRoot, "logs", "uninstall.timing.json"),
      uninstallerPath: join(namespaceRoot, "runtime", "install", "Open Design", "Uninstall Open Design.exe"),
      webStandaloneHookAuditPath: join(namespaceRoot, "web-standalone-after-pack-audit.json"),
      webStandaloneHookConfigPath: join(namespaceRoot, "web-standalone-after-pack-config.json"),
      webSidecarPrebundleMetaPath: join(namespaceRoot, "prebundle-meta", "web-sidecar.meta.json"),
      webSidecarPrebundlePath: join(namespaceRoot, "assembled", "app", "prebundled", "web", "web-sidecar.mjs"),
      winIconPath: join(namespaceRoot, "resources", "win", "icon.ico"),
      unpackedExePath: join(unpackedRoot, "Open Design.exe"),
      unpackedRoot,
    };
  }

  it("uses the release default compression when no override is set", async () => {
    const { extractedAppI18nLocales, extractedChromiumLocales, extractedConfig, originalConfig, timings } = await buildPortableZipFixture(undefined);
    const compressedArgs = timings.find(({ phase }) => phase === "portable-zip:7z:process")?.details?.args as
      | string[]
      | undefined;

    expect(compressedArgs).toContain("-mx=5");
    const { namespaceBaseRoot: _stripped, ...portableFields } = originalConfig;
    expect(extractedConfig).toEqual({ ...portableFields, portable: true });
    expect("namespaceBaseRoot" in extractedConfig).toBe(false);
    expect(extractedChromiumLocales).toEqual(["en-US.pak", "ko.pak"]);
    expect(extractedAppI18nLocales).toEqual(["ja.ts"]);
  }, 20_000);

  it("uses a faster local compression level override", async () => {
    const { extractedConfig, originalConfig, timings } = await buildPortableZipFixture("1");
    const compressedArgs = timings.find(({ phase }) => phase === "portable-zip:7z:process")?.details?.args as
      | string[]
      | undefined;

    expect(compressedArgs).toContain("-mx=1");
    const { namespaceBaseRoot: _stripped, ...portableFields } = originalConfig;
    expect(extractedConfig).toEqual({ ...portableFields, portable: true });
    expect("namespaceBaseRoot" in extractedConfig).toBe(false);
  }, 20_000);
});
