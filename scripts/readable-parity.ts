import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ReadableParityInventory {
  schemaVersion: 1;
  cliSubcommands: string[];
  mcpTools: string[];
  httpCapabilities: string[];
  bundledPlugins: string[];
  skills: string[];
  templates: string[];
  designSystems: string[];
  editingControlFamilies: string[];
  standaloneHtmlExport: string[];
}

const repoRoot = path.resolve(import.meta.dirname, "..");
const baselinePath = path.join(import.meta.dirname, "readable-parity.baseline.json");
const INVENTORY_FAMILIES = [
  "cliSubcommands",
  "mcpTools",
  "httpCapabilities",
  "bundledPlugins",
  "skills",
  "templates",
  "designSystems",
  "editingControlFamilies",
  "standaloneHtmlExport",
] as const;

const EDITING_CONTROL_SOURCES = {
  "box-model": "apps/web/src/components/ManualEditBoxModelControls.tsx",
  bridge: "apps/web/src/edit-mode/bridge.ts",
  geometry: "apps/web/src/components/ManualEditGeometryControls.tsx",
  move: "apps/web/src/components/ManualEditMoveFrame.tsx",
  page: "apps/web/src/components/ManualEditPageSection.tsx",
  resize: "apps/web/src/components/ManualEditResizeHandles.tsx",
  shape: "apps/web/src/components/ManualEditShapeControls.tsx",
  "snap-guides": "apps/web/src/components/ManualEditSnapGuides.tsx",
  text: "apps/web/src/components/ManualEditTextControls.tsx",
  typography: "apps/web/src/components/ManualEditTypographyToolbar.tsx",
} as const;

function lexicalSort(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

async function filesBelow(root: string, fileName?: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(entryPath, fileName));
    else if (fileName === undefined || entry.name === fileName) files.push(entryPath);
  }
  return lexicalSort(files);
}

async function immediateDirectoriesWithFile(root: string, fileName: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      await readFile(path.join(root, entry.name, fileName));
      ids.push(entry.name);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }
  }
  return lexicalSort(ids);
}

function sourceSection(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`Capability source boundary not found: ${start} ... ${end}`);
  }
  return source.slice(startIndex, endIndex);
}

async function collectCliSubcommands(root: string): Promise<string[]> {
  const source = await readFile(path.join(root, "apps/daemon/src/cli.ts"), "utf8");
  const map = sourceSection(source, "const SUBCOMMAND_MAP = {", "\n};");
  const commands: string[] = [];
  for (const match of map.matchAll(/^\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z][\w-]*))\s*:/gmu)) {
    commands.push(match[1] ?? match[2] ?? match[3]!);
  }
  return lexicalSort(commands);
}

async function collectMcpTools(root: string): Promise<string[]> {
  const source = await readFile(path.join(root, "apps/daemon/src/mcp.ts"), "utf8");
  const definitions = sourceSection(source, "const TOOL_DEFS = [", "\n];\n\nexport async function runMcpStdio");
  return lexicalSort([...definitions.matchAll(/\bname:\s*['"]([^'"]+)['"]/gu)].map((match) => match[1]!));
}

async function collectHttpCapabilities(root: string): Promise<string[]> {
  const sourceRoot = path.join(root, "apps/daemon/src");
  const capabilities: string[] = [];
  for (const file of await filesBelow(sourceRoot)) {
    if (!file.endsWith(".ts")) continue;
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/\b(?:app|router)\.(get|post|put|patch|delete)\(\s*['"](\/api\/[^'"]+)['"]/gu)) {
      capabilities.push(`${match[1]!.toUpperCase()} ${match[2]}`);
    }
  }
  return lexicalSort(capabilities);
}

async function collectBundledPlugins(root: string): Promise<string[]> {
  const names: string[] = [];
  for (const manifestPath of await filesBelow(path.join(root, "plugins/_official"), "open-design.json")) {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { name?: unknown };
    if (typeof manifest.name !== "string" || manifest.name.length === 0) {
      throw new Error(`${path.relative(root, manifestPath)}: bundled manifest has no name`);
    }
    names.push(manifest.name);
  }
  if (new Set(names).size !== names.length) throw new Error("Bundled plugin names must be unique");
  return lexicalSort(names);
}

async function collectEditingControls(root: string): Promise<string[]> {
  const controls: string[] = [];
  for (const [family, sourcePath] of Object.entries(EDITING_CONTROL_SOURCES)) {
    try {
      const source = await readFile(path.join(root, sourcePath), "utf8");
      if (source.trim().length > 0) controls.push(family);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return lexicalSort(controls);
}

async function collectStandaloneHtmlExport(root: string, cli: string[], http: string[]): Promise<string[]> {
  const capabilities: string[] = [];
  const cliSource = await readFile(path.join(root, "apps/daemon/src/cli.ts"), "utf8");
  if (cli.includes("export") && cliSource.includes("async function runExport") && cliSource.includes("args[0] !== 'html'")) {
    capabilities.push("cli:export-html");
  }
  if (http.includes("POST /api/exports/standalone-html")) capabilities.push("http:POST /api/exports/standalone-html");
  const webSource = await readFile(path.join(root, "apps/web/src/runtime/exports.ts"), "utf8");
  if (webSource.includes("export function exportProjectAsHtml") && webSource.includes("exportStandaloneHtml")) {
    capabilities.push("web:file-viewer-export");
  }
  const previewSource = await readFile(path.join(root, "apps/web/src/components/PreviewModal.tsx"), "utf8");
  if (previewSource.includes("exportStandaloneHtml")) capabilities.push("web:preview-modal-export");
  return lexicalSort(capabilities);
}

export async function collectReadableParityInventory(root = repoRoot): Promise<ReadableParityInventory> {
  const cliSubcommands = await collectCliSubcommands(root);
  const httpCapabilities = await collectHttpCapabilities(root);
  return {
    schemaVersion: 1,
    cliSubcommands,
    mcpTools: await collectMcpTools(root),
    httpCapabilities,
    bundledPlugins: await collectBundledPlugins(root),
    skills: await immediateDirectoriesWithFile(path.join(root, "skills"), "SKILL.md"),
    templates: await immediateDirectoriesWithFile(path.join(root, "design-templates"), "SKILL.md"),
    designSystems: await immediateDirectoriesWithFile(path.join(root, "design-systems"), "DESIGN.md"),
    editingControlFamilies: await collectEditingControls(root),
    standaloneHtmlExport: await collectStandaloneHtmlExport(root, cliSubcommands, httpCapabilities),
  };
}

function validateInventory(value: unknown, label: string): asserts value is ReadableParityInventory {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const candidate = value as Partial<ReadableParityInventory>;
  if (candidate.schemaVersion !== 1) throw new Error(`${label}.schemaVersion must be 1`);
  for (const family of INVENTORY_FAMILIES) {
    const values = candidate[family];
    if (!Array.isArray(values) || values.some((item) => typeof item !== "string")) {
      throw new Error(`${label}.${family} must be a string array`);
    }
  }
}

export function compareReadableParity(expected: ReadableParityInventory, actual: ReadableParityInventory): void {
  validateInventory(expected, "expected inventory");
  validateInventory(actual, "actual inventory");
  const differences: string[] = [];
  for (const family of INVENTORY_FAMILIES) {
    const expectedValues = new Set(expected[family]);
    const actualValues = new Set(actual[family]);
    const missing = lexicalSort([...expectedValues].filter((value) => !actualValues.has(value)));
    const unexpected = lexicalSort([...actualValues].filter((value) => !expectedValues.has(value)));
    if (missing.length > 0) differences.push(`missing ${family}: ${missing.join(", ")}`);
    if (unexpected.length > 0) differences.push(`unexpected ${family}: ${unexpected.join(", ")}`);
  }
  if (differences.length > 0) throw new Error(`Readable parity mismatch:\n${differences.join("\n")}`);
}

export async function readReadableParityBaseline(filePath = baselinePath): Promise<ReadableParityInventory> {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  validateInventory(parsed, "parity baseline");
  return parsed;
}

export async function collectReadableParity(root = repoRoot): Promise<{
  actual: ReadableParityInventory;
  expected: ReadableParityInventory;
}> {
  const [actual, expected] = await Promise.all([
    collectReadableParityInventory(root),
    readReadableParityBaseline(path.join(root, "scripts/readable-parity.baseline.json")),
  ]);
  return { actual, expected };
}

export function serializeReadableParity(inventory: ReadableParityInventory): string {
  validateInventory(inventory, "inventory");
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

function usageError(message: string): never {
  throw new Error(`${message}\nUsage: readable-parity collect --output <json>`);
}

async function main(argv: string[]): Promise<void> {
  const command = argv[0];
  if (command !== "collect") usageError(command === undefined ? "Missing command" : `Unknown command: ${command}`);
  let output: string | undefined;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output") {
      output = argv[index + 1];
      if (output === undefined || output.startsWith("--")) usageError("Missing value for --output");
      index += 1;
    } else {
      usageError(`Unknown argument: ${argument}`);
    }
  }
  if (output === undefined) usageError("Missing required --output <json>");
  const { actual, expected } = await collectReadableParity();
  compareReadableParity(expected, actual);
  await writeFile(path.resolve(output), serializeReadableParity(actual), "utf8");
  process.stdout.write(`Readable parity matched: ${INVENTORY_FAMILIES.map((family) => `${family}=${actual[family].length}`).join(" ")}\n`);
}

const entryPoint = process.argv[1] === undefined ? undefined : path.resolve(process.argv[1]);
if (entryPoint === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
