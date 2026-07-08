import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const desktopPackageRoot = join(repoRoot, "apps", "desktop");
const packagedSourcePath = join(repoRoot, "apps", "packaged", "src", "index.ts");

function readDesktopPackageJson(): {
  exports?: Record<string, { default?: string; types?: string }>;
  files?: string[];
} {
  return JSON.parse(readFileSync(join(desktopPackageRoot, "package.json"), "utf8"));
}

describe("desktop package runtime shape", () => {
  it("keeps exported desktop types inside the published dist allowlist", () => {
    const pkg = readDesktopPackageJson();

    // `assets` ships the splash page (splash.html + splash.mp4) that
    // desktop main loads as real files; see resolveSplashHtmlPath in
    // apps/desktop/src/main/runtime.ts.
    expect(pkg.files).toEqual(["assets", "dist"]);
    expect(pkg.exports?.["./main"]?.default).toBe("./dist/main/index.js");
    expect(pkg.exports?.["./main"]?.types).toBe("./dist/main/index.d.ts");
  });

  it("places the sandbox preload next to packaged app entrypoints", () => {
    const packagedSource = readFileSync(packagedSourcePath, "utf8");
    expect(packagedSource).toContain('preloadPath: join(app.getAppPath(), "preload.cjs")');

    for (const relativePath of [
      "tools/pack/src/mac/app.ts",
      "tools/pack/src/win/app.ts",
      "tools/pack/src/linux.ts",
    ]) {
      const source = readFileSync(join(repoRoot, relativePath), "utf8");
      expect(source).toContain('"apps", "desktop", "dist", "main", "preload.cjs"');
      expect(source).toContain('join(paths.assembledAppRoot, "preload.cjs")');
    }
  });

  it("stages the splash assets beside prebundled packaged app entrypoints", () => {
    // The standalone prebundle excludes the desktop tarball, so desktop main
    // resolves the splash page from `<appRoot>/assets/` (see
    // resolveSplashHtmlPath in apps/desktop/src/main/runtime.ts). Win and mac
    // stage the prebundle; linux installs desktop from its tarball, whose
    // published files already include `assets`.
    for (const relativePath of [
      "tools/pack/src/mac/app.ts",
      "tools/pack/src/win/app.ts",
    ]) {
      const source = readFileSync(join(repoRoot, relativePath), "utf8");
      expect(source).toContain('join(config.workspaceRoot, "apps", "desktop", "assets")');
      expect(source).toContain('join(paths.assembledAppRoot, "assets")');
    }
  });
});
