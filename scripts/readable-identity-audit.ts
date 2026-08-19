import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

export const identityClasses = [
  "active product",
  "machine contract to migrate",
  "generated derivative",
  "immutable history/provenance",
  "vendor/license",
  "deletion target",
] as const;

export type IdentityClass = (typeof identityClasses)[number];
export type IdentityScope = "active" | "all";
export type IdentityLocation = "content" | "path";
export type IdentityToken = "Open Design" | "open-design" | "OD_" | "od://" | "@open-design" | ".od" | "__od__";

export type IdentitySource = { path: string; source: string };
export type IdentityBaselineEntry = {
  class: IdentityClass;
  count: number;
  fingerprint: string;
  location: IdentityLocation;
  path: string;
  token: IdentityToken;
};
export type IdentityBaseline = {
  schemaVersion: 1;
  description: string;
  entries: IdentityBaselineEntry[];
};
type IdentityReportEntry = IdentityBaselineEntry & { firstLine: number };
export type IdentityAuditReport = {
  schemaVersion: 1;
  scope: IdentityScope;
  classCounts: Record<IdentityClass, number>;
  summary: { classified: number; files: number; matches: number; unclassified: number };
  entries: IdentityReportEntry[];
  unclassified: IdentityReportEntry[];
};
type AuditIdentitySourcesOptions = {
  baseline: IdentityBaselineEntry[];
  scope: IdentityScope;
  sources: IdentitySource[];
};

const repoRoot = path.resolve(import.meta.dirname, "..");
const baselinePath = path.join(import.meta.dirname, "readable-identity-baseline.json");
const auditInfrastructurePaths = new Set([
  "scripts/readable-identity-audit.ts",
  "scripts/readable-identity-audit.test.ts",
  "scripts/readable-identity-baseline.json",
]);
const activeClasses = new Set<IdentityClass>([
  "active product",
  "machine contract to migrate",
  "generated derivative",
  "deletion target",
]);
const identityPattern = /@open-design|Open Design|open-design|OD_|od:\/\/|__od__|\.od(?=$|[^A-Za-z0-9_])/g;

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isVendorOrLicensePath(repositoryPath: string): boolean {
  return repositoryPath === "LICENSE" || /(?:^|\/)(?:LICENSE|NOTICE|COPYING)(?:\.|$)/i.test(repositoryPath) ||
    repositoryPath.startsWith("vendor/") || repositoryPath.includes("/vendor/") ||
    repositoryPath.startsWith("design-templates/html-ppt/assets/");
}

function isImmutableHistoryPath(repositoryPath: string): boolean {
  return repositoryPath === "CHANGELOG.md" || repositoryPath.startsWith("specs/change/") ||
    repositoryPath.startsWith("mocks/traces/") ||
    /^v\d+\.\d+\.\d+_(?:implementation|plan)\.md$/.test(repositoryPath);
}

function isDeletionTargetPath(repositoryPath: string): boolean {
  return repositoryPath.startsWith("apps/landing-page/") || repositoryPath === "flake.nix" ||
    repositoryPath.startsWith("nix/") ||
    /(?:^|\/)(?:updater|release-feed|nsis|custom-installer)(?:[./-]|$)/i.test(repositoryPath) ||
    repositoryPath.startsWith("tools/pack/src/mac/") || repositoryPath.startsWith("tools/pack/resources/mac/") ||
    repositoryPath.startsWith("tools/pack/src/linux") || repositoryPath.startsWith("tools/pack/resources/linux/");
}

function isGeneratedDerivativePath(repositoryPath: string): boolean {
  return repositoryPath === "pnpm-lock.yaml" || repositoryPath.startsWith("generated/") ||
    repositoryPath.includes("/generated/") || repositoryPath.includes("/previews/") ||
    /\.(?:snap|lock)$/.test(repositoryPath);
}

function identityClassFor(repositoryPath: string, token: IdentityToken): IdentityClass {
  if (isVendorOrLicensePath(repositoryPath)) return "vendor/license";
  if (isImmutableHistoryPath(repositoryPath)) return "immutable history/provenance";
  if (isDeletionTargetPath(repositoryPath)) return "deletion target";
  if (isGeneratedDerivativePath(repositoryPath)) return "generated derivative";
  const extension = path.posix.extname(repositoryPath).toLowerCase();
  const isMachineFile = [".json", ".jsonc", ".toml", ".ts", ".tsx", ".yaml", ".yml"].includes(extension);
  if (token !== "Open Design" && isMachineFile) return "machine contract to migrate";
  return "active product";
}

function lineNumberForIndex(source: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) if (source.charCodeAt(cursor) === 10) line += 1;
  return line;
}

function entryKey(entry: Pick<IdentityBaselineEntry, "fingerprint" | "location" | "path" | "token">): string {
  return `${entry.location}\0${entry.path}\0${entry.token}\0${entry.fingerprint}`;
}

function matchFingerprint(location: IdentityLocation, value: string, index: number): string {
  const lineEnd = value.indexOf("\n", index);
  const context = location === "path"
    ? value
    : value.slice(value.lastIndexOf("\n", index - 1) + 1, lineEnd === -1 ? value.length : lineEnd);
  return createHash("sha256").update(context).digest("hex");
}

function compareEntries(left: IdentityBaselineEntry, right: IdentityBaselineEntry): number {
  return left.path.localeCompare(right.path, "en") || left.location.localeCompare(right.location, "en") ||
    left.token.localeCompare(right.token, "en") || left.fingerprint.localeCompare(right.fingerprint, "en") ||
    left.class.localeCompare(right.class, "en");
}

function emptyClassCounts(): Record<IdentityClass, number> {
  return {
    "active product": 0,
    "machine contract to migrate": 0,
    "generated derivative": 0,
    "immutable history/provenance": 0,
    "vendor/license": 0,
    "deletion target": 0,
  };
}

function collectMatches(sources: IdentitySource[], scope: IdentityScope): IdentityReportEntry[] {
  const grouped = new Map<string, IdentityReportEntry>();
  const addMatches = (repositoryPath: string, location: IdentityLocation, value: string): void => {
    identityPattern.lastIndex = 0;
    for (const match of value.matchAll(identityPattern)) {
      const token = match[0] as IdentityToken;
      const identityClass = identityClassFor(repositoryPath, token);
      if (scope === "active" && !activeClasses.has(identityClass)) continue;
      const candidate: IdentityReportEntry = {
        class: identityClass,
        count: 1,
        fingerprint: matchFingerprint(location, value, match.index ?? 0),
        firstLine: location === "path" ? 0 : lineNumberForIndex(value, match.index ?? 0),
        location,
        path: repositoryPath,
        token,
      };
      const key = entryKey(candidate);
      const existing = grouped.get(key);
      if (existing) existing.count += 1;
      else grouped.set(key, candidate);
    }
  };

  for (const item of [...sources].sort((left, right) => left.path.localeCompare(right.path, "en"))) {
    const repositoryPath = normalizePath(item.path);
    if (auditInfrastructurePaths.has(repositoryPath)) continue;
    addMatches(repositoryPath, "path", repositoryPath);
    addMatches(repositoryPath, "content", item.source);
  }
  return [...grouped.values()].sort(compareEntries);
}

export function auditIdentitySources(options: AuditIdentitySourcesOptions): IdentityAuditReport {
  const entries = collectMatches(options.sources, options.scope);
  const baselineByKey = new Map(options.baseline.map((entry) => [entryKey(entry), entry]));
  const classCounts = emptyClassCounts();
  const unclassified: IdentityReportEntry[] = [];
  for (const entry of entries) {
    classCounts[entry.class] += entry.count;
    if (!activeClasses.has(entry.class)) continue;
    const allowed = baselineByKey.get(entryKey(entry));
    const allowedCount = allowed?.class === entry.class ? allowed.count : 0;
    if (entry.count > allowedCount) unclassified.push({ ...entry, count: entry.count - allowedCount });
  }
  const matches = entries.reduce((total, entry) => total + entry.count, 0);
  const unclassifiedCount = unclassified.reduce((total, entry) => total + entry.count, 0);
  return {
    schemaVersion: 1,
    scope: options.scope,
    classCounts,
    summary: {
      classified: matches - unclassifiedCount,
      files: new Set(entries.map((entry) => entry.path)).size,
      matches,
      unclassified: unclassifiedCount,
    },
    entries,
    unclassified,
  };
}

export function formatIdentityAuditFailure(report: IdentityAuditReport): string {
  const tokenOrder: IdentityToken[] = ["Open Design", "open-design", "OD_", "od://", "@open-design", ".od", "__od__"];
  const foundTokens = tokenOrder.filter((token) => report.unclassified.some((entry) => entry.token === token));
  const details = report.unclassified.map((entry) =>
    `- ${entry.path}:${entry.firstLine} (${entry.location}) ${entry.token} x${entry.count} -> ${entry.class}`,
  );
  return [
    `Readable identity audit rejected ${report.summary.unclassified} unclassified active match(es).`,
    `Tokens: ${foundTokens.join(", ")}`,
    ...details,
    "Classify current residue in scripts/readable-identity-baseline.json or remove the active identity token.",
  ].join("\n");
}

export function assertIdentityAuditPassed(report: IdentityAuditReport): void {
  if (report.summary.unclassified > 0) throw new Error(formatIdentityAuditFailure(report));
}

async function trackedSources(root: string): Promise<IdentitySource[]> {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
  });
  const paths = stdout.toString("utf8").split("\0").filter((value) => value.length > 0)
    .sort((left, right) => left.localeCompare(right, "en"));
  const sources: IdentitySource[] = [];
  for (const repositoryPath of paths) {
    const contents = await readFile(path.join(root, repositoryPath));
    sources.push({ path: repositoryPath, source: contents.includes(0) ? "" : contents.toString("utf8") });
  }
  return sources;
}

export async function loadIdentityBaseline(): Promise<IdentityBaseline> {
  const value = JSON.parse(await readFile(baselinePath, "utf8")) as IdentityBaseline;
  if (value.schemaVersion !== 1 || !Array.isArray(value.entries)) {
    throw new Error("Invalid readable identity baseline: expected schemaVersion 1 and an entries array.");
  }
  return value;
}

export async function createIdentityBaseline(root = repoRoot): Promise<IdentityBaseline> {
  const entries = collectMatches(await trackedSources(root), "all").map(({ firstLine: _firstLine, ...entry }) => entry);
  return {
    schemaVersion: 1,
    description: "Classified tracked Open Design identity residue frozen before the Readable Studio cutover.",
    entries,
  };
}

export async function auditRepositoryIdentity(scope: IdentityScope, root = repoRoot): Promise<IdentityAuditReport> {
  const [baseline, sources] = await Promise.all([loadIdentityBaseline(), trackedSources(root)]);
  return auditIdentitySources({ baseline: baseline.entries, scope, sources });
}

export async function checkReadableIdentityAudit(): Promise<boolean> {
  try {
    const report = await auditRepositoryIdentity("active");
    assertIdentityAuditPassed(report);
    console.log(`Readable identity audit passed: ${report.summary.classified} classified active matches, 0 unclassified.`);
    return true;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return false;
  }
}

function parseArguments(argv: string[]): { report: string; scope: IdentityScope } {
  if (argv[0] !== "audit") throw new Error("Usage: readable-identity-audit.ts audit --scope <active|all> --report <json>");
  let scope: IdentityScope | undefined;
  let report: string | undefined;
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${flag ?? "argument"}.`);
    if (flag === "--scope") {
      if (value !== "active" && value !== "all") throw new Error(`Unknown scope: ${value}. Expected active or all.`);
      scope = value;
    } else if (flag === "--report") {
      if (value.length === 0) throw new Error("Missing report path.");
      report = value;
    } else {
      throw new Error(`Unknown argument: ${flag}.`);
    }
  }
  if (scope === undefined) throw new Error("Missing required --scope <active|all>.");
  if (report === undefined) throw new Error("Missing required --report <json>.");
  return { report, scope };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const report = await auditRepositoryIdentity(options.scope);
  await mkdir(path.dirname(path.resolve(options.report)), { recursive: true });
  await writeFile(options.report, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  assertIdentityAuditPassed(report);
  console.log(`Readable identity audit passed: scope=${options.scope}, matches=${report.summary.matches}, unclassified=0, report=${normalizePath(options.report)}`);
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
