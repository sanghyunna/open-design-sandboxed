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
const retiredDisplayName = ["Open", "Design"].join(" ");
const retiredSlug = ["open", "design"].join("-");
const retiredShortPrefix = ["O", "D", "_"].join("");
const retiredScheme = ["od", "://"].join("");
const retiredPackageScope = `@${retiredSlug}`;
const retiredDataDirectory = [".", "od"].join("");
const retiredHostGlobal = ["__", "od", "__"].join("");

export const identityTokens = [
  retiredDisplayName,
  retiredSlug,
  retiredShortPrefix,
  retiredScheme,
  retiredPackageScope,
  retiredDataDirectory,
  retiredHostGlobal,
] as const;

export type IdentityClass = (typeof identityClasses)[number];
export type IdentityScope = "active" | "all";
export type IdentityLocation = "content" | "path";
export type IdentityToken = (typeof identityTokens)[number];
export type IdentitySource = { path: string; source: string };
export type IdentityBaselineEntry = {
  class: IdentityClass;
  count: number;
  fingerprint: string;
  location: IdentityLocation;
  path: string;
  reason: string;
  ruleId: string;
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
  summary: { classified: number; files: number; matches: number; stale: number; unclassified: number };
  entries: IdentityReportEntry[];
  staleEntries: IdentityBaselineEntry[];
  unclassified: IdentityReportEntry[];
};
type AuditIdentitySourcesOptions = { baseline: IdentityBaselineEntry[]; scope: IdentityScope; sources: IdentitySource[] };

type ClassificationRule = { reason: string; ruleId: string };
const classificationRules: Record<IdentityClass, ClassificationRule> = {
  "active product": {
    ruleId: "identity.active-product",
    reason: "Repository-owned product identity residue awaiting migration.",
  },
  "machine contract to migrate": {
    ruleId: "identity.machine-contract",
    reason: "Machine-consumed identity contract awaiting coordinated migration.",
  },
  "generated derivative": {
    ruleId: "identity.generated-derivative",
    reason: "Generated identity derivative retained until its source is migrated and regenerated.",
  },
  "immutable history/provenance": {
    ruleId: "identity.immutable-history-provenance",
    reason: "Truthful immutable history or raw provenance retained without rewriting.",
  },
  "vendor/license": {
    ruleId: "identity.vendor-license",
    reason: "License obligation or third-party vendor provenance retained verbatim.",
  },
  "deletion target": {
    ruleId: "identity.deletion-target",
    reason: "Identity-bearing surface explicitly scheduled for deletion by the cutover plan.",
  },
};

const repoRoot = path.resolve(import.meta.dirname, "..");
const baselinePath = path.join(import.meta.dirname, "readable-identity-baseline.json");
const baselineRepositoryPath = "scripts/readable-identity-baseline.json";
const activeClasses = new Set<IdentityClass>([
  "active product",
  "machine contract to migrate",
  "generated derivative",
  "deletion target",
]);
const escapedIdentityTokens = identityTokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const escapedDataDirectory = escapedIdentityTokens[5];
const identityPattern = new RegExp(
  `${escapedIdentityTokens.filter((_, index) => index !== 5).join("|")}|${escapedDataDirectory}(?=$|[^A-Za-z0-9_])`,
  "g",
);
const identityClassSet = new Set<string>(identityClasses);
const identityTokenSet = new Set<string>(identityTokens);
const identityLocationSet = new Set<string>(["content", "path"]);
const baselineTopLevelFields = ["description", "entries", "schemaVersion"];
const baselineEntryFields = ["class", "count", "fingerprint", "location", "path", "reason", "ruleId", "token"];

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isVendorOrLicensePath(repositoryPath: string): boolean {
  return repositoryPath === "LICENSE" || /(?:^|\/)(?:LICENSE|NOTICE|COPYING)(?:\.|$)/i.test(repositoryPath) ||
    repositoryPath.startsWith("vendor/") || repositoryPath.includes("/vendor/") ||
    repositoryPath.startsWith("design-templates/html-ppt/assets/");
}

function isImmutableHistoryPath(repositoryPath: string): boolean {
  return repositoryPath === "CHANGELOG.md" || repositoryPath === "RELEASE-NOTES-0.10.0.md" ||
    repositoryPath === "docs/v0.8.0-announcement.md" || repositoryPath === "docs/v0.8.0-announcement.zh-CN.md" ||
    repositoryPath.startsWith("specs/change/") || repositoryPath.startsWith("specs/2026-04-29-live-artifacts/") ||
    repositoryPath === "mocks/manifest.json" || /^mocks\/golden\/[^/]+\.events\.json$/.test(repositoryPath) ||
    repositoryPath.startsWith("mocks/traces/") || /^v\d+\.\d+\.\d+_(?:implementation|plan)\.md$/.test(repositoryPath);
}

function isDeletionTargetPath(repositoryPath: string): boolean {
  return repositoryPath === "flake.nix" || repositoryPath === "flake.lock" ||
    repositoryPath.startsWith("nix/") ||
    /(?:^|\/)(?:updater|release-feed|nsis|custom-installer)(?:[./-]|$)/i.test(repositoryPath);
}

function isGeneratedDerivativePath(repositoryPath: string): boolean {
  return repositoryPath === "pnpm-lock.yaml" || repositoryPath.startsWith("generated/") ||
    repositoryPath.includes("/generated/") || repositoryPath.includes("/previews/") || /\.(?:snap|lock)$/.test(repositoryPath);
}

function identityClassFor(repositoryPath: string, token: IdentityToken): IdentityClass {
  if (isVendorOrLicensePath(repositoryPath)) return "vendor/license";
  if (isImmutableHistoryPath(repositoryPath)) return "immutable history/provenance";
  if (isDeletionTargetPath(repositoryPath)) return "deletion target";
  if (isGeneratedDerivativePath(repositoryPath)) return "generated derivative";
  const extension = path.posix.extname(repositoryPath).toLowerCase();
  if (token !== retiredDisplayName && [".json", ".jsonc", ".toml", ".ts", ".tsx", ".yaml", ".yml"].includes(extension)) {
    return "machine contract to migrate";
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactFields(value: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(value).sort((left, right) => left.localeCompare(right, "en"));
  const sortedExpected = [...expected].sort((left, right) => left.localeCompare(right, "en"));
  if (actual.join("\0") !== sortedExpected.join("\0")) {
    throw new Error(`Invalid readable identity baseline: ${label} fields must be exactly ${sortedExpected.join(", ")}.`);
  }
}

function parseCanonicalRepositoryPath(value: unknown, label: string): string {
  const errorMessage = `Invalid readable identity baseline: ${label} must be a canonical repository path.`;
  if (typeof value !== "string") throw new Error(errorMessage);
  const invalid = (): never => {
    throw new Error(errorMessage);
  };
  if (value.length === 0 || value.includes("\0") || value.includes("\\")) invalid();
  if (path.posix.isAbsolute(value) || /^[A-Za-z]:/.test(value)) invalid();
  if (value.endsWith("/") || path.posix.normalize(value) !== value) invalid();
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) invalid();
  return value;
}

function validateBaselineEntries(entries: unknown): IdentityBaselineEntry[] {
  if (!Array.isArray(entries)) throw new Error("Invalid readable identity baseline: entries must be an array.");
  const validated: IdentityBaselineEntry[] = [];
  const keys = new Set<string>();

  for (const [index, candidate] of entries.entries()) {
    if (!isRecord(candidate)) throw new Error(`Invalid readable identity baseline: entries[${index}] must be an object.`);
    assertExactFields(candidate, baselineEntryFields, `entries[${index}]`);
    if (!identityClassSet.has(String(candidate.class))) {
      throw new Error(`Invalid readable identity baseline: entries[${index}].class is not allowed.`);
    }
    if (!identityTokenSet.has(String(candidate.token))) {
      throw new Error(`Invalid readable identity baseline: entries[${index}].token is not allowed.`);
    }
    if (!identityLocationSet.has(String(candidate.location))) {
      throw new Error(`Invalid readable identity baseline: entries[${index}].location is not allowed.`);
    }
    if (!Number.isInteger(candidate.count) || Number(candidate.count) <= 0) {
      throw new Error(`Invalid readable identity baseline: entries[${index}].count must be a positive integer.`);
    }
    if (typeof candidate.fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(candidate.fingerprint)) {
      throw new Error(`Invalid readable identity baseline: entries[${index}].fingerprint must be lowercase SHA-256.`);
    }
    parseCanonicalRepositoryPath(candidate.path, `entries[${index}].path`);
    const identityClass = candidate.class as IdentityClass;
    const token = candidate.token as IdentityToken;
    const expectedClass = identityClassFor(String(candidate.path), token);
    if (identityClass !== expectedClass) {
      throw new Error(`Invalid readable identity baseline: entries[${index}].class must be ${expectedClass} for its path and token.`);
    }
    const rule = classificationRules[identityClass];
    if (candidate.ruleId !== rule.ruleId || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(String(candidate.ruleId))) {
      throw new Error(`Invalid readable identity baseline: entries[${index}].ruleId must equal ${rule.ruleId}.`);
    }
    if (candidate.reason !== rule.reason || String(candidate.reason).trim().length === 0) {
      throw new Error(`Invalid readable identity baseline: entries[${index}].reason must equal the stable rule reason.`);
    }

    const entry = candidate as IdentityBaselineEntry;
    const key = entryKey(entry);
    if (keys.has(key)) throw new Error(`Invalid readable identity baseline: duplicate key at entries[${index}].`);
    if (validated.length > 0 && compareEntries(validated[validated.length - 1]!, entry) >= 0) {
      throw new Error(`Invalid readable identity baseline: entries are not in canonical order at index ${index}.`);
    }
    keys.add(key);
    validated.push(entry);
  }
  return validated;
}

export function validateIdentityBaseline(value: unknown): IdentityBaseline {
  if (!isRecord(value)) throw new Error("Invalid readable identity baseline: root must be an object.");
  assertExactFields(value, baselineTopLevelFields, "root");
  if (value.schemaVersion !== 1) throw new Error("Invalid readable identity baseline: schemaVersion must be 1.");
  if (typeof value.description !== "string" || value.description.trim().length === 0) {
    throw new Error("Invalid readable identity baseline: description must be a nonempty string.");
  }
  const entries = validateBaselineEntries(value.entries);
  const forbidden = entries.find((entry) => activeClasses.has(entry.class));
  if (forbidden) {
    throw new Error(`Invalid readable identity baseline: ${forbidden.class} entries cannot be allowlisted after cutover.`);
  }
  return { schemaVersion: 1, description: value.description, entries };
}

function collectMatches(sources: IdentitySource[], scope: IdentityScope): IdentityReportEntry[] {
  const grouped = new Map<string, IdentityReportEntry>();
  const addMatches = (repositoryPath: string, location: IdentityLocation, value: string): void => {
    identityPattern.lastIndex = 0;
    for (const match of value.matchAll(identityPattern)) {
      const token = match[0] as IdentityToken;
      const identityClass = identityClassFor(repositoryPath, token);
      if (scope === "active" && !activeClasses.has(identityClass)) continue;
      const rule = classificationRules[identityClass];
      const candidate: IdentityReportEntry = {
        class: identityClass,
        count: 1,
        fingerprint: matchFingerprint(location, value, match.index ?? 0),
        firstLine: location === "path" ? 0 : lineNumberForIndex(value, match.index ?? 0),
        location,
        path: repositoryPath,
        reason: rule.reason,
        ruleId: rule.ruleId,
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
    if (repositoryPath === baselineRepositoryPath) continue;
    addMatches(repositoryPath, "path", repositoryPath);
    addMatches(repositoryPath, "content", item.source);
  }
  return [...grouped.values()].sort(compareEntries);
}

export function auditIdentitySources(options: AuditIdentitySourcesOptions): IdentityAuditReport {
  const validatedBaseline = validateBaselineEntries(options.baseline);
  const scopedBaseline = options.scope === "active"
    ? validatedBaseline.filter((entry) => activeClasses.has(entry.class))
    : validatedBaseline;
  const entries = collectMatches(options.sources, options.scope);
  const baselineByKey = new Map(scopedBaseline.map((entry) => [entryKey(entry), entry]));
  const observedByKey = new Map(entries.map((entry) => [entryKey(entry), entry]));
  const classCounts = emptyClassCounts();
  const unclassified: IdentityReportEntry[] = [];
  const staleEntries: IdentityBaselineEntry[] = [];

  for (const entry of entries) {
    classCounts[entry.class] += entry.count;
    const allowed = baselineByKey.get(entryKey(entry));
    const immutablePathAllowance = !activeClasses.has(entry.class);
    const allowedCount = immutablePathAllowance
      ? entry.count
      : allowed?.class === entry.class && allowed.ruleId === entry.ruleId && allowed.reason === entry.reason
        ? allowed.count
        : 0;
    if (entry.count > allowedCount) unclassified.push({ ...entry, count: entry.count - allowedCount });
  }
  for (const entry of scopedBaseline) {
    const observed = observedByKey.get(entryKey(entry));
    const observedCount = observed?.class === entry.class && observed.ruleId === entry.ruleId && observed.reason === entry.reason
      ? observed.count
      : 0;
    if (entry.count > observedCount) staleEntries.push({ ...entry, count: entry.count - observedCount });
  }

  const matches = entries.reduce((total, entry) => total + entry.count, 0);
  const unclassifiedCount = unclassified.reduce((total, entry) => total + entry.count, 0);
  const staleCount = staleEntries.reduce((total, entry) => total + entry.count, 0);
  return {
    schemaVersion: 1,
    scope: options.scope,
    classCounts,
    summary: {
      classified: matches - unclassifiedCount,
      files: new Set(entries.map((entry) => entry.path)).size,
      matches,
      stale: staleCount,
      unclassified: unclassifiedCount,
    },
    entries,
    staleEntries,
    unclassified,
  };
}

export function formatIdentityAuditFailure(report: IdentityAuditReport): string {
  const foundTokens = identityTokens.filter((token) => report.unclassified.some((entry) => entry.token === token));
  const unclassifiedDetails = report.unclassified.map((entry) =>
    `- unclassified ${entry.path}:${entry.firstLine} (${entry.location}) ${entry.token} x${entry.count} -> ${entry.class}`,
  );
  const staleDetails = report.staleEntries.map((entry) =>
    `- stale ${entry.path} (${entry.location}) ${entry.token} x${entry.count} -> ${entry.ruleId}`,
  );
  return [
    `Readable identity audit rejected ${report.summary.unclassified} unclassified match(es) and ${report.summary.stale} stale ledger match(es).`,
    `Tokens: ${foundTokens.join(", ")}`,
    ...unclassifiedDetails,
    ...staleDetails,
    "Regenerate the exact classified ledger after an intentional identity migration; path classes never bypass ledger enforcement.",
  ].join("\n");
}

export function assertIdentityAuditPassed(report: IdentityAuditReport): void {
  if (report.summary.unclassified > 0 || report.summary.stale > 0) throw new Error(formatIdentityAuditFailure(report));
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
  return validateIdentityBaseline(JSON.parse(await readFile(baselinePath, "utf8")) as unknown);
}

export async function createIdentityBaseline(root = repoRoot): Promise<IdentityBaseline> {
  const sources = await trackedSources(root);
  const activeEntries = collectMatches(sources, "active");
  if (activeEntries.length > 0) {
    throw new Error(formatIdentityAuditFailure(auditIdentitySources({ baseline: [], scope: "active", sources })));
  }
  return validateIdentityBaseline({
    schemaVersion: 1,
    description: "Active identity allowances are forbidden; immutable paths are classified by the audit's exact path policy.",
    entries: [],
  });
}

export async function auditRepositoryIdentity(scope: IdentityScope, root = repoRoot): Promise<IdentityAuditReport> {
  const [baseline, sources] = await Promise.all([loadIdentityBaseline(), trackedSources(root)]);
  return auditIdentitySources({ baseline: baseline.entries, scope, sources });
}

export async function checkReadableIdentityAudit(): Promise<boolean> {
  try {
    const report = await auditRepositoryIdentity("all");
    assertIdentityAuditPassed(report);
    console.log(`Readable identity audit passed: ${report.summary.classified} exact ledger matches, 0 unclassified, 0 stale.`);
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
  console.log(`Readable identity audit passed: scope=${options.scope}, matches=${report.summary.matches}, unclassified=0, stale=0, report=${normalizePath(options.report)}`);
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
