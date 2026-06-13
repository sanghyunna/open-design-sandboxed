import { describe, expect, it } from "vitest";

import {
  resolvePackagedUpdaterEnv,
  UPDATE_ENABLED_ENV,
  UPDATE_METADATA_URL_ENV,
} from "../src/updater-env.js";

const METADATA_URL = "https://releases.open-design.ai/beta/latest/metadata.json";

describe("resolvePackagedUpdaterEnv updater disable (fork never auto-updates)", () => {
  it("disables the updater for a portable run when OD_UPDATE_ENABLED is unset", () => {
    const overrides = resolvePackagedUpdaterEnv({
      updateMetadataUrl: METADATA_URL,
      portable: true,
      env: {},
    });

    expect(overrides[UPDATE_ENABLED_ENV]).toBe("0");
  });

  it("leaves an explicit OD_UPDATE_ENABLED untouched in a portable run", () => {
    const overrides = resolvePackagedUpdaterEnv({
      updateMetadataUrl: METADATA_URL,
      portable: true,
      env: { [UPDATE_ENABLED_ENV]: "1" },
    });

    expect(overrides).not.toHaveProperty(UPDATE_ENABLED_ENV);
  });

  it("disables the updater for a non-portable run too (regression: win-unpacked pulled upstream 0.10.1)", () => {
    const overrides = resolvePackagedUpdaterEnv({
      updateMetadataUrl: METADATA_URL,
      portable: false,
      env: {},
    });

    expect(overrides[UPDATE_ENABLED_ENV]).toBe("0");
  });

  it("leaves an explicit OD_UPDATE_ENABLED untouched in a non-portable run", () => {
    const overrides = resolvePackagedUpdaterEnv({
      updateMetadataUrl: METADATA_URL,
      portable: false,
      env: { [UPDATE_ENABLED_ENV]: "1" },
    });

    expect(overrides).not.toHaveProperty(UPDATE_ENABLED_ENV);
  });

  it("still applies the baked metadata URL when unset, regardless of portable mode", () => {
    const overrides = resolvePackagedUpdaterEnv({
      updateMetadataUrl: METADATA_URL,
      portable: true,
      env: {},
    });

    expect(overrides[UPDATE_METADATA_URL_ENV]).toBe(METADATA_URL);
  });

  it("never overwrites an explicit metadata URL", () => {
    const overrides = resolvePackagedUpdaterEnv({
      updateMetadataUrl: METADATA_URL,
      portable: false,
      env: { [UPDATE_METADATA_URL_ENV]: "https://example.test/custom.json" },
    });

    expect(overrides).not.toHaveProperty(UPDATE_METADATA_URL_ENV);
  });

  it("emits no metadata override when the baked URL is absent", () => {
    const overrides = resolvePackagedUpdaterEnv({
      updateMetadataUrl: null,
      portable: true,
      env: {},
    });

    expect(overrides).not.toHaveProperty(UPDATE_METADATA_URL_ENV);
    // ...but the portable gate still fires independently of the metadata URL.
    expect(overrides[UPDATE_ENABLED_ENV]).toBe("0");
  });
});
