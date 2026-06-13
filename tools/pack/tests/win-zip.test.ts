import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import type { ToolPackConfig } from "../src/config.js";
import { winResources } from "../src/resources.js";
import { buildWinPortableZipCacheKeyInput } from "../src/win/builder.js";
import { buildWinPortableZip, withPortableConfigFlag } from "../src/win/zip.js";
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

// Integration: drives the real bundled 7z twice (archive, then the portable
// patch pass) and verifies the second pass replaced the config entry in place
// while leaving the rest of the tree intact. Win32-only and tiny, mirroring the
// existing launcher-payload 7z specs; it completes well under 2s.
describe.skipIf(process.platform !== "win32")("buildWinPortableZip portable injection", () => {
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

  it(
    "replaces the config entry with a portable-flagged copy while leaving the tree untouched",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "od-tools-pack-portable-zip-"));
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
          namespace: "rg",
          namespaceBaseRoot: bakedNamespaceBaseRoot,
          futureField: 7,
        };
        await writeFile(
          join(unpackedRoot, "resources", "open-design-config.json"),
          `${JSON.stringify(originalConfig, null, 2)}\n`,
          "utf8",
        );
        await writeFile(join(unpackedRoot, "Open Design.exe"), "fake-exe", "utf8");
        await writeFile(join(unpackedRoot, "resources", "app.txt"), "fake-resource", "utf8");

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

        await buildWinPortableZip({} as ToolPackConfig, paths, builtApp);

        const extractRoot = join(root, "extracted");
        await mkdir(extractRoot, { recursive: true });
        await execFileAsync(winResources.sevenZipExe, ["x", setupZipPath, `-o${extractRoot}`, "-y"]);

        const extractedConfig = JSON.parse(
          await readFile(join(extractRoot, "resources", "open-design-config.json"), "utf8"),
        ) as Record<string, unknown>;
        // Patched in place: portable true, the baked namespaceBaseRoot gone,
        // every other original field preserved.
        const { namespaceBaseRoot: _stripped, ...portableFields } = originalConfig;
        expect(extractedConfig).toEqual({ ...portableFields, portable: true });
        expect("namespaceBaseRoot" in extractedConfig).toBe(false);

        // The rest of the tree shipped untouched, and the shared unpacked tree's
        // config on disk was NOT modified by the injection.
        await expect(access(join(extractRoot, "Open Design.exe"))).resolves.toBeUndefined();
        await expect(access(join(extractRoot, "resources", "app.txt"))).resolves.toBeUndefined();
        const onDiskConfig = JSON.parse(
          await readFile(join(unpackedRoot, "resources", "open-design-config.json"), "utf8"),
        ) as Record<string, unknown>;
        expect(onDiskConfig).toEqual(originalConfig);
      } finally {
        await rm(root, { force: true, recursive: true });
      }
    },
    20_000,
  );
});
