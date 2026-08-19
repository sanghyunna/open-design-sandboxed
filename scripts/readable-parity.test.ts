import assert from "node:assert/strict";
import { test } from "node:test";

import {
  collectReadableParity,
  compareReadableParity,
  type ReadableParityInventory,
} from "./readable-parity.ts";

test("collector matches the checked-in capability baseline", async () => {
  const { actual, expected } = await collectReadableParity();
  assert.doesNotThrow(() => compareReadableParity(expected, actual));
});

test("rejects missing capability", async (t) => {
  const { actual } = await collectReadableParity();
  const omissions: Array<[Exclude<keyof ReadableParityInventory, "schemaVersion">, string]> = [
    ["cliSubcommands", "export"],
    ["bundledPlugins", "build-test"],
    ["editingControlFamilies", "resize"],
    ["standaloneHtmlExport", "http:POST /api/exports/standalone-html"],
  ];

  for (const [family, capability] of omissions) {
    const incomplete = structuredClone(actual);
    const values = incomplete[family];
    assert.ok(Array.isArray(values), `${family} must be an inventory array`);
    incomplete[family] = values.filter((value) => value !== capability) as never;

    let diagnostic: string | undefined;
    try {
      compareReadableParity(actual, incomplete);
    } catch (error) {
      assert.ok(error instanceof Error);
      diagnostic = error.message;
    }
    const expectedDiagnostic = `Readable parity mismatch:\nmissing ${family}: ${capability}`;
    assert.equal(diagnostic, expectedDiagnostic);
    t.diagnostic(expectedDiagnostic);
  }
});
