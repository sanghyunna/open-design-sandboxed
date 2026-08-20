import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

const runtimeSource = readFileSync(new URL("../../src/main/runtime.ts", import.meta.url), "utf8");
const splashSource = readFileSync(new URL("../../assets/splash.html", import.meta.url), "utf8");
const splashIconSource = readFileSync(new URL("../../assets/splash-icon.svg", import.meta.url), "utf8");
const approvedAppIconSource = readFileSync(new URL("../../../web/public/app-icon.svg", import.meta.url), "utf8");

describe("desktop BrowserWindow chrome options", () => {
  test("hides Electron's native menu bar in the Windows/Linux app window", () => {
    const browserWindowBlock = /new BrowserWindow\(\{([\s\S]*?)minWidth: 900,([\s\S]*?)webPreferences:/.exec(runtimeSource)?.[0] ?? "";

    expect(browserWindowBlock).toContain("autoHideMenuBar: true");
  });

  test("keeps macOS traffic-light controls clear of the web tab strip", () => {
    expect(runtimeSource).toContain("--app-chrome-traffic-space: 96px !important;");
    expect(runtimeSource).toContain("--app-chrome-traffic-margin: 12px !important;");
    expect(runtimeSource).toContain("flex: 0 0 96px !important;");
    expect(runtimeSource).toContain("width: 96px !important;");
  });

  test("keeps the visible renderer responsive when Chromium misclassifies visibility", () => {
    const browserWindowBlock = /new BrowserWindow\(\{([\s\S]*?)minWidth: 900,([\s\S]*?)width: 1280,/.exec(runtimeSource)?.[0] ?? "";

    expect(browserWindowBlock).toContain("backgroundThrottling: false");
  });

  test("uses the approved splash icon while retaining cover-sized video playback", () => {
    const videoStyles = /video \{([\s\S]*?)\}/.exec(splashSource)?.[0] ?? "";

    expect(splashSource).toContain('src="splash-icon.svg"');
    expect(videoStyles).toContain("object-fit: cover");
    expect(videoStyles).toContain("opacity: 0");
    expect(splashIconSource).toBe(approvedAppIconSource);
  });
});
