import { describe, expect, it } from "vitest";

import {
  resolveElectronBuilderWinTargets,
  resolveWinTargets,
  shouldBuildWinPortableZip,
} from "../src/win/report.js";

describe("Windows portable build targets", () => {
  it("resolves the portable zip as the only public and electron-builder target", () => {
    expect(resolveWinTargets("zip")).toEqual(["zip"]);
    expect(resolveElectronBuilderWinTargets("zip")).toEqual(["dir"]);
  });

  it("builds only the portable zip artifact", () => {
    expect(shouldBuildWinPortableZip("zip")).toBe(true);
  });
});
