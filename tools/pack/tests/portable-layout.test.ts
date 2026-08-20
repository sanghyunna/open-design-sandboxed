import { describe, expect, it } from "vitest";

import { PRODUCT_NAME, WEB_STANDALONE_RESOURCE_NAME } from "../src/win/constants.js";

describe("Windows portable layout", () => {
  it("uses the Readable Studio artifact and standalone resource names", () => {
    expect(PRODUCT_NAME).toBe("Readable Studio");
    expect(WEB_STANDALONE_RESOURCE_NAME).toBe("readable-studio-web-standalone");
  });
});
