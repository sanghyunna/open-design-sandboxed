import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const roots = ["skills", "design-templates", "plugins/_official/examples"];
const skippedDirectories = new Set([".git", "node_modules"]);
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

export async function checkBundledCopyLanguage(root = repoRoot, checkedRoots = roots): Promise<boolean> {
  const violations = await collectBundledCopyLanguageViolations(root, checkedRoots);
  if (violations.length === 0) {
    console.log("Bundled copy language check passed: runtime defaults contain no unscoped Han script characters.");
    return true;
  }

  console.error("Bundled copy language violations found:");
  for (const violation of violations) console.error(`- ${violation.filePath}:${violation.lineNumber} \`${violation.character}\``);
  return false;
}
