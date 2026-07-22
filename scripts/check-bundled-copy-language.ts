import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const roots = ["skills", "design-templates", "plugins/_official/examples"];
const skippedDirectories = new Set([".git", "node_modules"]);
const pluginExamplesRoot = "plugins/_official/examples";

export type CanonicalCatalogueCopyGroup = {
  derivedRoot: "design-templates" | "skills";
  filePath: "SKILL.md" | "example.html";
  ids: readonly string[];
};

// These are the reviewed files that are deliberately mirrored from the bundled
// plugin examples. Entries with their own implementation or extra assets stay
// out of this map rather than being forced into a broad directory comparison.
export const canonicalCatalogueCopyGroups: readonly CanonicalCatalogueCopyGroup[] = [
  {
    derivedRoot: "design-templates",
    filePath: "example.html",
    ids: [
      "blog-post", "clinical-case-report", "dashboard", "dating-web", "digital-eguide", "docs-page", "email-marketing",
      "eng-runbook", "finance-report", "flowai-live-dashboard-template", "gamified-app", "github-dashboard", "hr-onboarding",
      "html-ppt-course-module", "html-ppt-dir-key-nav-minimal", "html-ppt-graphify-dark-graph",
      "html-ppt-hermes-cyber-terminal", "html-ppt-knowledge-arch-blueprint", "html-ppt-obsidian-claude-gradient",
      "html-ppt-pitch-deck", "html-ppt-presenter-mode-reveal", "html-ppt-product-launch", "html-ppt-taste-brutalist",
      "html-ppt-tech-sharing", "html-ppt-testing-safety-alert", "html-ppt-weekly-report", "html-ppt-xhs-pastel-card",
      "html-ppt-xhs-post", "html-ppt-xhs-white-editorial", "html-ppt-zhangzara-8-bit-orbit",
      "html-ppt-zhangzara-biennale-yellow", "html-ppt-zhangzara-block-frame", "html-ppt-zhangzara-blue-professional",
      "html-ppt-zhangzara-bold-poster", "html-ppt-zhangzara-broadside", "html-ppt-zhangzara-capsule",
      "html-ppt-zhangzara-cartesian", "html-ppt-zhangzara-cobalt-grid", "html-ppt-zhangzara-coral",
      "html-ppt-zhangzara-creative-mode", "html-ppt-zhangzara-daisy-days", "html-ppt-zhangzara-editorial-tri-tone",
      "html-ppt-zhangzara-grove", "html-ppt-zhangzara-long-table", "html-ppt-zhangzara-mat", "html-ppt-zhangzara-monochrome",
      "html-ppt-zhangzara-neo-grid-bold", "html-ppt-zhangzara-peoples-platform", "html-ppt-zhangzara-pin-and-paper",
      "html-ppt-zhangzara-pink-script", "html-ppt-zhangzara-playful", "html-ppt-zhangzara-raw-grid",
      "html-ppt-zhangzara-retro-windows", "html-ppt-zhangzara-retro-zine", "html-ppt-zhangzara-scatterbrain",
      "html-ppt-zhangzara-signal", "html-ppt-zhangzara-soft-editorial", "html-ppt-zhangzara-stencil-tablet",
      "html-ppt-zhangzara-studio", "html-ppt-zhangzara-vellum", "ib-pitch-book", "invoice", "kami-deck", "kanban-board",
      "magazine-poster", "meeting-notes", "mobile-app", "mobile-onboarding", "open-design-landing-deck", "pm-spec",
      "pricing-page", "saas-landing", "social-carousel", "social-media-dashboard", "sprite-animation", "team-okrs",
      "trading-analysis-dashboard-template", "tweaks", "waitlist-page", "web-prototype", "web-prototype-taste-brutalist",
      "web-prototype-taste-editorial", "web-prototype-taste-soft", "weekly-update", "wireframe-sketch",
    ],
  },
  {
    derivedRoot: "design-templates",
    filePath: "SKILL.md",
    ids: [
      "clinical-case-report", "dcf-valuation", "flowai-live-dashboard-template", "html-ppt-taste-brutalist",
      "html-ppt-zhangzara-8-bit-orbit", "html-ppt-zhangzara-biennale-yellow", "html-ppt-zhangzara-block-frame",
      "html-ppt-zhangzara-blue-professional", "html-ppt-zhangzara-bold-poster", "html-ppt-zhangzara-broadside",
      "html-ppt-zhangzara-capsule", "html-ppt-zhangzara-cartesian", "html-ppt-zhangzara-cobalt-grid",
      "html-ppt-zhangzara-coral", "html-ppt-zhangzara-creative-mode", "html-ppt-zhangzara-daisy-days",
      "html-ppt-zhangzara-editorial-tri-tone", "html-ppt-zhangzara-grove", "html-ppt-zhangzara-long-table",
      "html-ppt-zhangzara-mat", "html-ppt-zhangzara-monochrome", "html-ppt-zhangzara-neo-grid-bold",
      "html-ppt-zhangzara-peoples-platform", "html-ppt-zhangzara-pin-and-paper", "html-ppt-zhangzara-pink-script",
      "html-ppt-zhangzara-playful", "html-ppt-zhangzara-raw-grid", "html-ppt-zhangzara-retro-windows",
      "html-ppt-zhangzara-retro-zine", "html-ppt-zhangzara-sakura-chroma", "html-ppt-zhangzara-scatterbrain",
      "html-ppt-zhangzara-signal", "html-ppt-zhangzara-soft-editorial", "html-ppt-zhangzara-stencil-tablet",
      "html-ppt-zhangzara-studio", "html-ppt-zhangzara-vellum", "last30days", "saas-landing", "team-okrs",
      "web-prototype-taste-editorial", "web-prototype-taste-soft", "weekly-update", "wireframe-sketch", "x-research",
    ],
  },
  {
    derivedRoot: "skills",
    filePath: "SKILL.md",
    ids: ["deck-guizang-editorial", "deck-open-slide-canvas", "deck-swiss-international", "design-brief", "pptx-html-fidelity-audit"],
  },
  {
    derivedRoot: "skills",
    filePath: "example.html",
    ids: ["doc-kami-parchment", "frame-glitch-title", "frame-light-leak-cinema", "frame-logo-outro", "social-reddit-card", "social-spotify-card"],
  },
];
const intentionalHanPaths = new Set([
  // The upstream Xiaohongshu client preserves its API's Chinese enum literals.
  "design-templates/last30days/scripts/lib/xiaohongshu_api.py",
  "design-templates/wireframe-sketch/example.html",
  "design-templates/sprite-animation/example.html",
  "design-templates/html-ppt-zhangzara-sakura-chroma/example.html",
  // Bundled copies of the reviewed Japanese-language demo previews.
  "plugins/_official/examples/sprite-animation/example.html",
  "plugins/_official/examples/wireframe-sketch/example.html",
  "design-templates/guizang-ppt/LICENSE",
]);
const hanScriptPattern = /\p{Script=Han}/gu;
const explicitLocaleKeyPattern = /^(\s*)(?:["']?)(zh-CN|zh-TW)(?:["']?)\s*:/;
const scopedChineseScalarKeyPattern = /^(\s*)(?:["']?)(zh_name|zh_description)(?:["']?)\s*:\s*(?![>|](?:\s|$))/;

export type BundledCopyLanguageViolation = {
  filePath: string;
  lineNumber: number;
  character: string;
};

export type CanonicalCatalogueCopyViolation = {
  canonicalPath: string;
  derivedPath: string;
  reason: "missing" | "diverged";
};

function lineNumberForIndex(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function maskRange(source: string, start: number, end: number): string {
  return `${source.slice(0, start)}${" ".repeat(end - start)}${source.slice(end)}`;
}

function maskExplicitYamlLocaleValues(source: string): string {
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter?.[1]) return source;

  const lines = frontmatter[1].match(/.*(?:\r?\n|$)/g) ?? [];
  let masked = source;
  let offset = source.match(/^---\r?\n/)![0].length;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const localeMatch = line.match(explicitLocaleKeyPattern);
    const match = localeMatch ?? line.match(scopedChineseScalarKeyPattern);
    if (!match) {
      offset += line.length;
      continue;
    }

    const valueStart = offset + match[0].length;
    let valueEnd = offset + line.length;
    if (localeMatch && /[>|]\s*(?:#.*)?\r?\n?$/.test(line)) {
      const indentation = match[1]!.length;
      let nextOffset = valueEnd;
      while (index + 1 < lines.length) {
        const nextLine = lines[index + 1]!;
        const nextIndentation = nextLine.match(/^\s*/)?.[0]?.length ?? 0;
        if (nextLine.trim() && nextIndentation <= indentation) break;
        index += 1;
        valueEnd = nextOffset + nextLine.length;
        nextOffset = valueEnd;
      }
    }
    masked = maskRange(masked, valueStart, valueEnd);
    offset = valueEnd;
  }

  return masked;
}

function maskExplicitJsonLocaleValues(source: string): string {
  try {
    JSON.parse(source);
  } catch {
    return source;
  }

  return source.replace(
    /(^|[,{]\s*)("(?:zh-CN|zh-TW|ja|ja-JP)"\s*:\s*)("(?:\\.|[^"\\])*")/gm,
    (_, before: string, key: string, value: string) => `${before}${key}${" ".repeat(value.length)}`,
  );
}

function sourceWithoutExplicitLocalizedValues(repositoryPath: string, source: string): string {
  if (path.basename(repositoryPath) === "SKILL.md") return maskExplicitYamlLocaleValues(source);
  if (path.basename(repositoryPath) === "open-design.json") return maskExplicitJsonLocaleValues(source);
  return source;
}

export function collectBundledCopyLanguageViolationsFromSource(
  repositoryPath: string,
  source: string,
): BundledCopyLanguageViolation[] {
  if (intentionalHanPaths.has(repositoryPath)) return [];

  const checkedSource = sourceWithoutExplicitLocalizedValues(repositoryPath, source);
  return [...checkedSource.matchAll(hanScriptPattern)].map((match) => ({
    filePath: repositoryPath,
    lineNumber: lineNumberForIndex(source, match.index ?? 0),
    character: match[0],
  }));
}

export async function collectBundledCopyLanguageViolations(
  root = repoRoot,
  checkedRoots = roots,
): Promise<BundledCopyLanguageViolation[]> {
  const violations: BundledCopyLanguageViolation[] = [];

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!skippedDirectories.has(entry.name)) await visit(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      let source: string;
      try {
        source = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(fullPath));
      } catch {
        continue;
      }
      const repositoryPath = path.relative(root, fullPath).split(path.sep).join("/");
      violations.push(...collectBundledCopyLanguageViolationsFromSource(repositoryPath, source));
    }
  }

  for (const checkedRoot of checkedRoots) {
    try {
      await visit(path.join(root, checkedRoot));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return violations;
}

function normalizeMirroredCopy(source: string): string {
  return source.replace(/\r\n/g, "\n");
}

export async function collectCanonicalCatalogueCopyViolations(
  root = repoRoot,
  groups: readonly CanonicalCatalogueCopyGroup[] = canonicalCatalogueCopyGroups,
): Promise<CanonicalCatalogueCopyViolation[]> {
  const violations: CanonicalCatalogueCopyViolation[] = [];

  for (const group of groups) {
    for (const id of group.ids) {
      const canonicalPath = `${pluginExamplesRoot}/${id}/${group.filePath}`;
      const derivedPath = `${group.derivedRoot}/${id}/${group.filePath}`;
      try {
        const [canonical, derived] = await Promise.all([
          readFile(path.join(root, canonicalPath), "utf8"),
          readFile(path.join(root, derivedPath), "utf8"),
        ]);
        if (normalizeMirroredCopy(canonical) !== normalizeMirroredCopy(derived)) {
          violations.push({ canonicalPath, derivedPath, reason: "diverged" });
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          violations.push({ canonicalPath, derivedPath, reason: "missing" });
          continue;
        }
        throw error;
      }
    }
  }

  return violations;
}

export async function checkBundledCopyLanguage(
  root = repoRoot,
  checkedRoots = roots,
  canonicalCopyGroups: readonly CanonicalCatalogueCopyGroup[] = root === repoRoot ? canonicalCatalogueCopyGroups : [],
): Promise<boolean> {
  const violations = await collectBundledCopyLanguageViolations(root, checkedRoots);
  const canonicalCopyViolations = await collectCanonicalCatalogueCopyViolations(root, canonicalCopyGroups);
  if (violations.length === 0 && canonicalCopyViolations.length === 0) {
    console.log("Bundled copy language check passed: runtime defaults contain no unscoped Han script characters and canonical copies match.");
    return true;
  }

  if (violations.length > 0) {
    console.error("Bundled copy language violations found:");
    for (const violation of violations) console.error(`- ${violation.filePath}:${violation.lineNumber} \`${violation.character}\``);
  }
  if (canonicalCopyViolations.length > 0) {
    console.error("Bundled canonical copy violations found:");
    for (const violation of canonicalCopyViolations) {
      console.error(`- ${violation.derivedPath} ${violation.reason} from ${violation.canonicalPath}`);
    }
  }
  return false;
}
