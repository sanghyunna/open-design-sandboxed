import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { listSkills } from "../apps/daemon/src/skills.ts";
import { parseDesignSystemProjectManifest } from "../design-systems/_schema/manifest.schema.ts";
import { parseFrontmatter } from "../packages/plugin-runtime/src/parsers/frontmatter.ts";
import { parseManifest } from "../packages/plugin-runtime/src/parsers/manifest.ts";

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

type StandaloneSources = {
  cliSource: string;
  webSource: string;
  previewSource: string;
  cliSubcommands: string[];
  httpCapabilities: string[];
};

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
  "box-model": ["apps/web/src/components/ManualEditBoxModelControls.tsx", "ManualEditBoxModelControls"],
  bridge: ["apps/web/src/edit-mode/bridge.ts", "buildManualEditBridge"],
  geometry: ["apps/web/src/components/ManualEditGeometryControls.tsx", "ManualEditGeometryControls"],
  move: ["apps/web/src/components/ManualEditMoveFrame.tsx", "ManualEditMoveFrame"],
  page: ["apps/web/src/components/ManualEditPageSection.tsx", "ManualEditPageSection"],
  resize: ["apps/web/src/components/ManualEditResizeHandles.tsx", "ManualEditResizeHandles"],
  shape: ["apps/web/src/components/ManualEditShapeControls.tsx", "ManualEditShapeControls"],
  "snap-guides": ["apps/web/src/components/ManualEditSnapGuides.tsx", "ManualEditSnapGuides"],
  text: ["apps/web/src/components/ManualEditTextControls.tsx", "ManualEditTextControls"],
  typography: ["apps/web/src/components/ManualEditTypographyToolbar.tsx", "ManualEditTypographyToolbar"],
} as const;

function lexicalSort(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function parseTypeScript(source: string, label: string): ts.SourceFile {
  const sourceFile = ts.createSourceFile(label, source, ts.ScriptTarget.Latest, true, label.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const diagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diagnostics.length > 0) {
    const diagnostic = diagnostics[0]!;
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
    throw new Error(`${label}: invalid TypeScript: ${message}`);
  }
  return sourceFile;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
  ) current = current.expression;
  return current;
}

function findVariableInitializer(sourceFile: ts.SourceFile, variableName: string, label: string): ts.Expression {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === variableName && declaration.initializer) {
        return unwrapExpression(declaration.initializer);
      }
    }
  }
  throw new Error(`${label}: missing variable ${variableName}`);
}

function staticPropertyName(name: ts.PropertyName | undefined, label: string): string {
  if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))) return name.text;
  throw new Error(`${label}: capability key must be a static property name`);
}

export function extractCliSubcommands(source: string, label = "CLI source"): string[] {
  const sourceFile = parseTypeScript(source, label);
  const initializer = findVariableInitializer(sourceFile, "SUBCOMMAND_MAP", label);
  if (!ts.isObjectLiteralExpression(initializer)) throw new Error(`${label}: SUBCOMMAND_MAP must be an object literal`);
  return lexicalSort(initializer.properties.map((property, index) => {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
      throw new Error(`${label}: SUBCOMMAND_MAP[${index}] must be a property assignment`);
    }
    return staticPropertyName(property.name, `${label}: SUBCOMMAND_MAP[${index}]`);
  }));
}

export function extractMcpTools(source: string, label = "MCP source"): string[] {
  const sourceFile = parseTypeScript(source, label);
  const initializer = findVariableInitializer(sourceFile, "TOOL_DEFS", label);
  if (!ts.isArrayLiteralExpression(initializer)) throw new Error(`${label}: TOOL_DEFS must be an array literal`);
  return lexicalSort(initializer.elements.map((element, index) => {
    const value = unwrapExpression(element);
    if (!ts.isObjectLiteralExpression(value)) throw new Error(`${label}: TOOL_DEFS[${index}] must be an object literal`);
    const property = value.properties.find((candidate) =>
      (ts.isPropertyAssignment(candidate) || ts.isShorthandPropertyAssignment(candidate))
      && staticPropertyName(candidate.name, label) === "name");
    if (!property || !ts.isPropertyAssignment(property)) throw new Error(`${label}: TOOL_DEFS[${index}].name must be a string literal`);
    const name = unwrapExpression(property.initializer);
    if (!ts.isStringLiteral(name) || name.text.length === 0) throw new Error(`${label}: TOOL_DEFS[${index}].name must be a string literal`);
    return name.text;
  }));
}

export function extractHttpCapabilities(source: string, label = "HTTP source"): string[] {
  const sourceFile = parseTypeScript(source, label);
  const capabilities: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const owner = node.expression.expression;
      const method = node.expression.name.text.toLowerCase();
      const firstArgument = node.arguments[0];
      if (
        ts.isIdentifier(owner)
        && (owner.text === "app" || owner.text === "router")
        && ["get", "post", "put", "patch", "delete"].includes(method)
        && firstArgument
        && ts.isStringLiteralLike(firstArgument)
        && firstArgument.text.startsWith("/api/")
      ) capabilities.push(`${method.toUpperCase()} ${firstArgument.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return lexicalSort(capabilities);
}

export function parseBundledPluginId(raw: string, label: string): string {
  const result = parseManifest(raw);
  if (!result.ok) throw new Error(`${label}: invalid bundled plugin manifest: ${result.errors.join("; ")}`);
  return result.manifest.name;
}

export function parseSkillId(raw: string, label: string): string {
  let data: Record<string, unknown>;
  try {
    const parsed = parseFrontmatter(raw).data;
    data = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch (error) {
    throw new Error(`${label}: invalid skill frontmatter: ${error instanceof Error ? error.message : String(error)}`);
  }
  const name = data.name;
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9._-]*$/u.test(name)) {
    throw new Error(`${label}: frontmatter name must be a nonempty capability id`);
  }
  return name;
}

export function parseDesignSystemId(raw: string, folderId: string, label: string): string {
  const result = parseDesignSystemProjectManifest(raw);
  if (!result.ok) throw new Error(`${label}: invalid design-system manifest: ${result.errors.join("; ")}`);
  if (result.manifest.id !== folderId) throw new Error(`${label}: design-system id ${result.manifest.id} does not match folder ${folderId}`);
  return result.manifest.id;
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false);
}

export function sourceExportsRuntimeSymbol(source: string, symbol: string, label: string): boolean {
  const sourceFile = parseTypeScript(source, label);
  for (const statement of sourceFile.statements) {
    if (!hasExportModifier(statement)) continue;
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === symbol) return true;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === symbol) return true;
      }
    }
  }
  return false;
}

function findFunction(sourceFile: ts.SourceFile, name: string): ts.FunctionDeclaration | undefined {
  return sourceFile.statements.find((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === name);
}

function nodeContainsString(node: ts.Node, value: string): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (
      (ts.isStringLiteralLike(child) || ts.isTemplateLiteralToken(child))
      && child.text === value
    ) found = true;
    if (!found) ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function sourceCallsIdentifier(sourceFile: ts.SourceFile, identifier: string): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === identifier) found = true;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

export function extractStandaloneHtmlCapabilities(input: StandaloneSources): string[] {
  const capabilities: string[] = [];
  const cliAst = parseTypeScript(input.cliSource, "standalone CLI source");
  const runExport = findFunction(cliAst, "runExport");
  if (
    input.cliSubcommands.includes("export")
    && runExport
    && nodeContainsString(runExport, "html")
    && nodeContainsString(runExport, "/api/exports/standalone-html")
  ) capabilities.push("cli:export-html");
  if (input.httpCapabilities.includes("POST /api/exports/standalone-html")) {
    capabilities.push("http:POST /api/exports/standalone-html");
  }
  const webAst = parseTypeScript(input.webSource, "standalone web source");
  if (
    sourceExportsRuntimeSymbol(input.webSource, "exportStandaloneHtml", "standalone web source")
    && sourceExportsRuntimeSymbol(input.webSource, "exportProjectAsHtml", "standalone web source")
    && sourceCallsIdentifier(webAst, "exportStandaloneHtml")
  ) capabilities.push("web:file-viewer-export");
  const previewAst = parseTypeScript(input.previewSource, "PreviewModal.tsx");
  if (
    sourceExportsRuntimeSymbol(input.previewSource, "PreviewModal", "PreviewModal.tsx")
    && sourceCallsIdentifier(previewAst, "exportStandaloneHtml")
  ) capabilities.push("web:preview-modal-export");
  return lexicalSort(capabilities);
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

async function collectRuntimeSkillDirectory(root: string, family: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const parentIds: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(root, entry.name, "SKILL.md");
    let raw: string;
    try {
      raw = await readFile(skillPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    parentIds.push(parseSkillId(raw, `${family}/${entry.name}/SKILL.md`));
  }
  if (new Set(parentIds).size !== parentIds.length) throw new Error(`${family}: parent capability ids must be unique`);

  const runtimeIds = (await listSkills(root)).map((skill) => skill.id);
  if (new Set(runtimeIds).size !== runtimeIds.length) throw new Error(`${family}: runtime capability ids must be unique`);
  const runtimeSet = new Set(runtimeIds);
  const missingParents = lexicalSort(parentIds.filter((id) => !runtimeSet.has(id)));
  if (missingParents.length > 0) throw new Error(`${family}: runtime omitted validated parents: ${missingParents.join(", ")}`);
  return lexicalSort(runtimeIds);
}

async function collectDesignSystems(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;
    const manifestPath = path.join(root, entry.name, "manifest.json");
    let raw: string;
    try {
      raw = await readFile(manifestPath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`design-systems/${entry.name}: missing manifest.json`);
      throw error;
    }
    const id = parseDesignSystemId(raw, entry.name, `design-systems/${entry.name}/manifest.json`);
    const parsed = parseDesignSystemProjectManifest(raw);
    if (!parsed.ok) throw new Error(`design-systems/${entry.name}: invalid manifest`);
    await readFile(path.join(root, entry.name, parsed.manifest.files.design), "utf8");
    ids.push(id);
  }
  if (new Set(ids).size !== ids.length) throw new Error("design-systems: capability ids must be unique");
  return lexicalSort(ids);
}

async function collectEditingControls(root: string): Promise<string[]> {
  const controls: string[] = [];
  for (const [family, [sourcePath, symbol]] of Object.entries(EDITING_CONTROL_SOURCES)) {
    const source = await readFile(path.join(root, sourcePath), "utf8");
    if (!sourceExportsRuntimeSymbol(source, symbol, sourcePath)) {
      throw new Error(`${sourcePath}: missing exported runtime symbol ${symbol}`);
    }
    controls.push(family);
  }
  return lexicalSort(controls);
}

export async function collectReadableParityInventory(root = repoRoot): Promise<ReadableParityInventory> {
  const cliPath = path.join(root, "apps/daemon/src/cli.ts");
  const mcpPath = path.join(root, "apps/daemon/src/mcp.ts");
  const cliSource = await readFile(cliPath, "utf8");
  const mcpSource = await readFile(mcpPath, "utf8");
  const cliSubcommands = extractCliSubcommands(cliSource, "apps/daemon/src/cli.ts");
  const httpCapabilities: string[] = [];
  for (const file of await filesBelow(path.join(root, "apps/daemon/src"))) {
    if (!file.endsWith(".ts")) continue;
    httpCapabilities.push(...extractHttpCapabilities(await readFile(file, "utf8"), path.relative(root, file).replaceAll(path.sep, "/")));
  }
  const bundledPlugins: string[] = [];
  for (const manifestPath of await filesBelow(path.join(root, "plugins/_official"), "open-design.json")) {
    bundledPlugins.push(parseBundledPluginId(
      await readFile(manifestPath, "utf8"),
      path.relative(root, manifestPath).replaceAll(path.sep, "/"),
    ));
  }
  if (new Set(bundledPlugins).size !== bundledPlugins.length) throw new Error("bundled plugin capability ids must be unique");
  const normalizedHttp = lexicalSort(httpCapabilities);
  const standaloneHtmlExport = extractStandaloneHtmlCapabilities({
    cliSource,
    webSource: await readFile(path.join(root, "apps/web/src/runtime/exports.ts"), "utf8"),
    previewSource: await readFile(path.join(root, "apps/web/src/components/PreviewModal.tsx"), "utf8"),
    cliSubcommands,
    httpCapabilities: normalizedHttp,
  });
  return {
    schemaVersion: 1,
    cliSubcommands,
    mcpTools: extractMcpTools(mcpSource, "apps/daemon/src/mcp.ts"),
    httpCapabilities: normalizedHttp,
    bundledPlugins: lexicalSort(bundledPlugins),
    skills: await collectRuntimeSkillDirectory(path.join(root, "skills"), "skills"),
    templates: await collectRuntimeSkillDirectory(path.join(root, "design-templates"), "design-templates"),
    designSystems: await collectDesignSystems(path.join(root, "design-systems")),
    editingControlFamilies: await collectEditingControls(root),
    standaloneHtmlExport,
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
    if (JSON.stringify(values) !== JSON.stringify(lexicalSort(values))) {
      throw new Error(`${label}.${family} must be sorted and unique`);
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

export async function collectReadableParity(root = repoRoot): Promise<{ actual: ReadableParityInventory; expected: ReadableParityInventory }> {
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
    } else usageError(`Unknown argument: ${argument}`);
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
