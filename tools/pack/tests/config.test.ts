import { afterEach, describe, expect, it } from "vitest";

import { resolveToolPackConfig } from "../src/config.js";

const savedAmrProfile = process.env.OPEN_DESIGN_AMR_PROFILE;

afterEach(() => {
  if (savedAmrProfile == null) {
    delete process.env.OPEN_DESIGN_AMR_PROFILE;
  } else {
    process.env.OPEN_DESIGN_AMR_PROFILE = savedAmrProfile;
  }
});

describe("resolveToolPackConfig AMR profile", () => {
  it("bakes OPEN_DESIGN_AMR_PROFILE into packaged config when set at build time", () => {
    process.env.OPEN_DESIGN_AMR_PROFILE = "test";
    const config = resolveToolPackConfig("mac", { namespace: "amr-profile-test" });
    expect(config.amrProfile).toBe("test");
  });

  it("rejects unsupported AMR profiles before packaging", () => {
    process.env.OPEN_DESIGN_AMR_PROFILE = "staging";
    expect(() => resolveToolPackConfig("mac")).toThrow(
      /OPEN_DESIGN_AMR_PROFILE must be prod, test, or local/,
    );
  });
});

describe("resolveToolPackConfig Vela CLI requirement", () => {
  it("defaults to optional Vela CLI bundling", () => {
    const config = resolveToolPackConfig("mac", { namespace: "vela-optional-test" });
    expect(config.requireVelaCli).toBe(false);
  });

  it("reads --require-vela-cli from build options", () => {
    const config = resolveToolPackConfig("mac", {
      namespace: "vela-required-test",
      requireVelaCli: true,
    });
    expect(config.requireVelaCli).toBe(true);
  });
});

describe("resolveToolPackConfig win build target", () => {
  it("accepts the portable zip target and rejects unsupported values", () => {
    expect(resolveToolPackConfig("win", { to: "zip" }).to).toBe("zip");
    expect(resolveToolPackConfig("win", { to: "all" }).to).toBe("all");
    expect(resolveToolPackConfig("win", { to: "nsis" }).to).toBe("nsis");
    expect(() => resolveToolPackConfig("win", { to: "dmg" })).toThrow(/unsupported win --to target: dmg/);
  });
});

describe("resolveToolPackConfig namespace defaults", () => {
  it("keeps ordinary local builds on the default namespace", () => {
    expect(resolveToolPackConfig("mac").namespace).toBe("default");
    expect(resolveToolPackConfig("win", { appVersion: "0.8.0" }).namespace).toBe("default");
  });

  it("defaults prerelease mac builds to their release channel namespace", () => {
    expect(resolveToolPackConfig("mac", { appVersion: "0.8.0-beta.4" }).namespace).toBe("release-beta");
    expect(resolveToolPackConfig("mac", { appVersion: "0.8.0-preview.4" }).namespace).toBe("release-preview");
    expect(resolveToolPackConfig("mac", { appVersion: "0.8.0.nightly.4" }).namespace).toBe("release-nightly");
  });

  it("defaults prerelease non-mac builds to platform-specific release channel namespaces", () => {
    expect(resolveToolPackConfig("win", { appVersion: "0.8.0-beta.4" }).namespace).toBe("release-beta-win");
    expect(resolveToolPackConfig("linux", { appVersion: "0.8.0-preview.4" }).namespace).toBe("release-preview-linux");
    expect(resolveToolPackConfig("win", { appVersion: "0.8.0.nightly.4" }).namespace).toBe("release-nightly-win");
  });

  it("keeps an explicit namespace ahead of the prerelease channel default", () => {
    expect(resolveToolPackConfig("mac", { appVersion: "0.8.0-beta.4", namespace: "custom-beta" }).namespace).toBe(
      "custom-beta",
    );
  });
});
