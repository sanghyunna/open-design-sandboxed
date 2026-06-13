import { describe, expect, it } from "vitest";

import {
  resolveElectronBuilderWinTargets,
  resolveWinTargets,
  shouldBuildWinLauncherPayload,
  shouldBuildWinNsisInstaller,
  shouldBuildWinPortableZip,
} from "../src/win/report.js";

describe("resolveWinTargets", () => {
  it("returns the full target set including the portable zip for `all`", () => {
    expect(resolveWinTargets("all")).toEqual(["dir", "nsis", "zip"]);
  });

  it("returns only the requested single target", () => {
    expect(resolveWinTargets("dir")).toEqual(["dir"]);
    expect(resolveWinTargets("nsis")).toEqual(["nsis"]);
    expect(resolveWinTargets("zip")).toEqual(["zip"]);
  });
});

describe("resolveElectronBuilderWinTargets", () => {
  it("hides the portable zip from electron-builder because it is built from the cached unpacked dir", () => {
    expect(resolveElectronBuilderWinTargets("zip")).toEqual(["dir"]);
    expect(resolveElectronBuilderWinTargets("all")).toEqual(["dir", "nsis"]);
    expect(resolveElectronBuilderWinTargets("nsis")).toEqual(["nsis"]);
    expect(resolveElectronBuilderWinTargets("dir")).toEqual(["dir"]);
  });
});

describe("shouldBuildWinNsisInstaller / shouldBuildWinPortableZip", () => {
  it("flags the NSIS installer and portable zip independently", () => {
    expect(shouldBuildWinNsisInstaller("nsis")).toBe(true);
    expect(shouldBuildWinNsisInstaller("all")).toBe(true);
    expect(shouldBuildWinNsisInstaller("zip")).toBe(false);
    expect(shouldBuildWinNsisInstaller("dir")).toBe(false);

    expect(shouldBuildWinPortableZip("zip")).toBe(true);
    expect(shouldBuildWinPortableZip("all")).toBe(true);
    expect(shouldBuildWinPortableZip("nsis")).toBe(false);
    expect(shouldBuildWinPortableZip("dir")).toBe(false);
  });
});

describe("shouldBuildWinLauncherPayload", () => {
  it("skips the launcher/auto-update payload only for a pure portable-zip build", () => {
    // The portable zip is self-contained and ships with the updater disabled, so
    // the `.od://` launcher delivery archive is wasted work for `--to zip`.
    expect(shouldBuildWinLauncherPayload("zip")).toBe(false);
    // Every other target still builds it (installer/launcher/release flows).
    expect(shouldBuildWinLauncherPayload("all")).toBe(true);
    expect(shouldBuildWinLauncherPayload("nsis")).toBe(true);
    expect(shouldBuildWinLauncherPayload("dir")).toBe(true);
  });
});
