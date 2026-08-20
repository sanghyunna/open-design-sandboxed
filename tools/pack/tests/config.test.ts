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
    const config = resolveToolPackConfig("win", { namespace: "amr-profile-test" });
    expect(config.amrProfile).toBe("test");
  });

  it("rejects unsupported AMR profiles before packaging", () => {
    process.env.OPEN_DESIGN_AMR_PROFILE = "staging";
    expect(() => resolveToolPackConfig("win")).toThrow(
      /OPEN_DESIGN_AMR_PROFILE must be prod, test, or local/,
    );
  });
});

describe("resolveToolPackConfig Vela CLI requirement", () => {
  it("defaults to optional Vela CLI bundling", () => {
    const config = resolveToolPackConfig("win", { namespace: "vela-optional-test" });
    expect(config.requireVelaCli).toBe(false);
  });

  it("reads --require-vela-cli from build options", () => {
    const config = resolveToolPackConfig("win", {
      namespace: "vela-required-test",
      requireVelaCli: true,
    });
    expect(config.requireVelaCli).toBe(true);
  });
});

describe("resolveToolPackConfig win build target", () => {
  it("defaults to the portable zip target", () => {
    expect(resolveToolPackConfig("win").to).toBe("zip");
  });

  it("accepts only the portable zip target", () => {
    expect(resolveToolPackConfig("win", { to: "zip" }).to).toBe("zip");
    expect(() => resolveToolPackConfig("win", { to: "all" })).toThrow(/unsupported win --to target: all/);
    expect(() => resolveToolPackConfig("win", { to: "dir" })).toThrow(/unsupported win --to target: dir/);
    expect(() => resolveToolPackConfig("win", { to: "nsis" })).toThrow(/unsupported win --to target: nsis/);
  });
});

describe("resolveToolPackConfig namespace defaults", () => {
  it("keeps ordinary local builds on the default namespace", () => {
    expect(resolveToolPackConfig("win").namespace).toBe("default");
    expect(resolveToolPackConfig("win", { appVersion: "0.8.0" }).namespace).toBe("default");
  });

  it("defaults prerelease builds to Windows release channel namespaces", () => {
    expect(resolveToolPackConfig("win", { appVersion: "0.8.0-beta.4" }).namespace).toBe("release-beta-win");
    expect(resolveToolPackConfig("win", { appVersion: "0.8.0-preview.4" }).namespace).toBe("release-preview-win");
    expect(resolveToolPackConfig("win", { appVersion: "0.8.0.nightly.4" }).namespace).toBe("release-nightly-win");
  });

  it("keeps an explicit namespace ahead of the prerelease channel default", () => {
    expect(resolveToolPackConfig("win", { appVersion: "0.8.0-beta.4", namespace: "custom-beta" }).namespace).toBe(
      "custom-beta",
    );
  });
});
