import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { listSkills } from "../apps/daemon/src/skills.ts";

import {
  collectReadableParity,
  compareReadableParity,
  extractCliSubcommands,
  extractHttpCapabilities,
  extractMcpTools,
  extractStandaloneHtmlCapabilities,
  parseBundledPluginId,
  parseDesignSystemId,
  parseSkillId,
  sourceExportsRuntimeSymbol,
  type ReadableParityInventory,
} from "./readable-parity.ts";

const collectedParity = collectReadableParity();

test("collector matches the checked-in capability baseline", async () => {
  const { actual, expected } = await collectedParity;
  assert.doesNotThrow(() => compareReadableParity(expected, actual));
});

test("each inventory family has an independent structured validator seam", () => {
  assert.deepEqual(
    extractCliSubcommands("const SUBCOMMAND_MAP = { export: runExport, 'design-systems': runDesignSystems };", "cli fixture"),
    ["design-systems", "export"],
  );
  assert.deepEqual(
    extractMcpTools("const TOOL_DEFS = [{ name: 'create_artifact' }, { name: 'get_file' }];", "mcp fixture"),
    ["create_artifact", "get_file"],
  );
  assert.deepEqual(
    extractHttpCapabilities("app.post('/api/exports/standalone-html', handler);", "http fixture"),
    ["POST /api/exports/standalone-html"],
  );
  assert.equal(
    parseBundledPluginId('{"name":"build-test","version":"0.1.0"}', "plugin fixture"),
    "build-test",
  );
  assert.equal(parseSkillId("---\nname: pptx\ndescription: fixture\n---\n# Body", "skill fixture"), "pptx");
  assert.equal(parseSkillId("---\nname: html-ppt\ndescription: fixture\n---\n# Body", "template fixture"), "html-ppt");
  assert.equal(
    parseDesignSystemId(JSON.stringify({
      schemaVersion: "readable.design-system-project/v1",
      id: "default",
      name: "Default",
      category: "Starter",
      source: { type: "bundled" },
      files: { design: "DESIGN.md", tokens: "tokens.css" },
    }), "default", "design-system fixture"),
    "default",
  );
  assert.equal(
    sourceExportsRuntimeSymbol("export function ManualEditResizeHandles() {}", "ManualEditResizeHandles", "editing fixture"),
    true,
  );
  assert.deepEqual(
    extractStandaloneHtmlCapabilities({
      cliSource: "async function runExport(args) { if (args[0] !== 'html') return; return fetch('/api/exports/standalone-html'); }",
      webSource: "export async function exportStandaloneHtml() {} export function exportProjectAsHtml() { return exportStandaloneHtml(); }",
      previewSource: "export function PreviewModal() { return exportStandaloneHtml(); }",
      cliSubcommands: ["export"],
      httpCapabilities: ["POST /api/exports/standalone-html"],
    }),
    ["cli:export-html", "http:POST /api/exports/standalone-html", "web:file-viewer-export", "web:preview-modal-export"],
  );
});

test("structured validators reject malformed capability declarations", () => {
  assert.throws(() => extractCliSubcommands("const OTHER = {};", "cli fixture"), /cli fixture: missing variable SUBCOMMAND_MAP/u);
  assert.throws(() => extractMcpTools("const TOOL_DEFS = [{ title: 'missing name' }];", "mcp fixture"), /TOOL_DEFS\[0\].name/u);
  assert.throws(() => extractHttpCapabilities("app.get('/api/broken'", "http fixture"), /invalid TypeScript/u);
  assert.throws(() => parseBundledPluginId('{"name":"broken"}', "plugin fixture"), /invalid bundled plugin manifest/u);
  assert.throws(() => parseSkillId("# no frontmatter", "skill fixture"), /frontmatter name/u);
  assert.throws(() => parseDesignSystemId("{}", "broken", "design fixture"), /invalid design-system manifest/u);
  assert.equal(sourceExportsRuntimeSymbol("export function Other() {}", "ManualEditResizeHandles", "editing fixture"), false);
});

test("live inventory exposes representative machine capabilities from every family", async () => {
  const { actual } = await collectedParity;
  for (const [family, capability] of [
    ["cliSubcommands", "export"],
    ["mcpTools", "create_artifact"],
    ["httpCapabilities", "POST /api/exports/standalone-html"],
    ["bundledPlugins", "build-test"],
    ["skills", "pptx"],
    ["templates", "html-ppt"],
    ["designSystems", "default"],
    ["editingControlFamilies", "resize"],
    ["standaloneHtmlExport", "http:POST /api/exports/standalone-html"],
  ] as const) {
    assert.ok(actual[family].includes(capability), `${family} must expose ${capability}`);
  }
});

test("template inventory exactly matches the daemon runtime registry", async () => {
  const { actual } = await collectedParity;
  const runtimeIds = (await listSkills(path.resolve("design-templates")))
    .map((template) => template.id)
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  assert.deepEqual(actual.templates, runtimeIds);
});

test("rejects missing capability", async (t) => {
  const { actual } = await collectedParity;
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
