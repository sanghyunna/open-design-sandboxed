import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type CopySource = {
  path: string;
  source: string;
};

export type CopyPolicyMatch = {
  id: string;
  path: string;
  line: number;
  excerpt: string;
};

export type CopyPolicyReport = {
  schemaVersion: 1;
  ok: boolean;
  files: Array<{ path: string; bytes: number }>;
  pillars: Array<{ id: string; present: boolean; matches: CopyPolicyMatch[] }>;
  retiredClaims: CopyPolicyMatch[];
  forbiddenDistributionClaims: CopyPolicyMatch[];
  summary: {
    files: number;
    presentPillars: number;
    missingPillars: number;
    retiredClaims: number;
    forbiddenDistributionClaims: number;
  };
};

type Rule = {
  id: string;
  pattern: RegExp;
};

const doctrineRules: readonly Rule[] = [
  { id: "source-text", pattern: /\bsource[- ]text\b|\bsource (?:documents?|material|content)\b/i },
  { id: "ai-generation", pattern: /\bAI[- ](?:assisted )?generation\b|\bAI (?:creates?|drafts?|generates?|transforms?|turns)\b/i },
  { id: "direct-editing", pattern: /\bPowerPoint-like\b|\bdirect editing\b|\bedit(?:able)? (?:directly|in place)\b/i },
  { id: "standalone-html", pattern: /\bstandalone HTML\b/i },
  { id: "office-workers", pattern: /\boffice workers?\b/i },
  { id: "enterprise-ai-transformation", pattern: /\benterprise AI transformation\b/i },
];

const retiredClaimRules: readonly Rule[] = [
  { id: "claude-alternative", pattern: /\b(?:open-source )?Claude Design alternative\b/i },
  { id: "fellow-program", pattern: /\bReadable Studio Fellows?\b/i },
  { id: "community-positioning", pattern: /\bReadable Studio community\b|\bjoin (?:the )?(?:Readable Studio )?(?:community|discussion)\b/i },
  { id: "official-router", pattern: /\bofficial (?:AMR )?(?:model service|Model Router)\b|\bReadable Studio AMR\b/i },
];

const forbiddenDistributionRules: readonly Rule[] = [
  { id: "product-website", pattern: /\bofficial product website\b|>Website<|\bdownload\b[^\n]*\breadable-studio\.ai\b/i },
  { id: "automatic-updater", pattern: /\bautomatic updater\b|\bauto(?:matic)?[- ]updates?\b|\bchecks? for updates?\b/i },
  { id: "unsupported-distribution", pattern: /\bLinux AppImage\b|\bmacOS installers?\b|\b(?:macOS|Linux)\b[^\n]*\b(?:download|artifact|package|build)\b/i },
];

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function excerptForLine(line: string): string {
  return line.trim().replace(/\s+/g, " ").slice(0, 240);
}

const explicitNegationPattern = /\b(?:no|not|never|without|does not|do not|is not|are not|has no|have no)\b/i;
const contrastPattern = /\b(?:but|however|yet)\b/gi;

function isExplicitlyNegated(line: string, matchIndex: number): boolean {
  const prefix = line.slice(0, matchIndex);
  const punctuationStart = Math.max(prefix.lastIndexOf("."), prefix.lastIndexOf(";"), prefix.lastIndexOf(":"));
  let contrastStart = -1;
  for (const match of prefix.matchAll(contrastPattern)) contrastStart = match.index + match[0].length - 1;
  return explicitNegationPattern.test(prefix.slice(Math.max(punctuationStart, contrastStart) + 1));
}

function collectMatches(rule: Rule, source: CopySource, ignoreExplicitNegation = false): CopyPolicyMatch[] {
  const matches: CopyPolicyMatch[] = [];
  for (const [index, line] of source.source.split(/\r?\n/).entries()) {
    const match = rule.pattern.exec(line);
    if (match && !(ignoreExplicitNegation && isExplicitlyNegated(line, match.index))) {
      matches.push({
        id: rule.id,
        path: normalizePath(source.path),
        line: index + 1,
        excerpt: excerptForLine(line),
      });
    }
  }
  return matches;
}

function collectRuleSet(
  rules: readonly Rule[],
  sources: readonly CopySource[],
  ignoreExplicitNegation = false,
): CopyPolicyMatch[] {
  return rules.flatMap((rule) => sources.flatMap((source) => collectMatches(rule, source, ignoreExplicitNegation)));
}

export function auditCopySources(sources: readonly CopySource[]): CopyPolicyReport {
  const sortedSources = [...sources].sort((left, right) => normalizePath(left.path).localeCompare(normalizePath(right.path)));
  const pillars = doctrineRules.map((rule) => {
    const matches = sortedSources.flatMap((source) => collectMatches(rule, source));
    return { id: rule.id, present: matches.length > 0, matches };
  });
  const retiredClaims = collectRuleSet(retiredClaimRules, sortedSources);
  const forbiddenDistributionClaims = collectRuleSet(forbiddenDistributionRules, sortedSources, true);
  const presentPillars = pillars.filter(({ present }) => present).length;
  const missingPillars = pillars.length - presentPillars;

  return {
    schemaVersion: 1,
    ok: missingPillars === 0 && retiredClaims.length === 0 && forbiddenDistributionClaims.length === 0,
    files: sortedSources.map((source) => ({
      path: normalizePath(source.path),
      bytes: Buffer.byteLength(source.source),
    })),
    pillars,
    retiredClaims,
    forbiddenDistributionClaims,
    summary: {
      files: sortedSources.length,
      presentPillars,
      missingPillars,
      retiredClaims: retiredClaims.length,
      forbiddenDistributionClaims: forbiddenDistributionClaims.length,
    },
  };
}

export function renderCopyPolicyReport(report: CopyPolicyReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export type CopyPolicyArgs = {
  reportPath: string;
  paths: string[];
};

export function parseCopyPolicyArgs(args: readonly string[]): CopyPolicyArgs {
  if (args[0] !== "audit") {
    throw new Error('expected command "audit"');
  }

  let reportPath: string | undefined;
  const paths: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--report") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--report requires a JSON path");
      reportPath = value;
      index += 1;
      continue;
    }
    if (arg?.startsWith("--")) throw new Error(`unknown option: ${arg}`);
    if (arg) paths.push(arg);
  }

  if (!reportPath) throw new Error("audit requires --report <json>");
  if (paths.length === 0) throw new Error("audit requires at least one path");
  return { reportPath, paths };
}

export async function runCopyPolicy(args: readonly string[]): Promise<number> {
  const options = parseCopyPolicyArgs(args);
  const sources = await Promise.all(
    options.paths.map(async (filePath) => ({ path: filePath, source: await readFile(filePath, "utf8") })),
  );
  const report = auditCopySources(sources);
  await mkdir(path.dirname(path.resolve(options.reportPath)), { recursive: true });
  await writeFile(options.reportPath, renderCopyPolicyReport(report), "utf8");

  if (!report.ok) {
    console.error(
      `Readable copy policy rejected ${report.summary.missingPillars} missing doctrine pillars, ${report.summary.retiredClaims} retired claims, and ${report.summary.forbiddenDistributionClaims} forbidden distribution claims.`,
    );
    return 1;
  }
  console.log(`Readable copy policy passed: ${report.summary.presentPillars} doctrine pillars across ${report.summary.files} files.`);
  return 0;
}

const isMain = process.argv[1] != null && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    process.exitCode = await runCopyPolicy(process.argv.slice(2));
  } catch (error) {
    console.error(`Readable copy policy error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
