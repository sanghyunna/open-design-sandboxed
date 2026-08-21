import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { collectReadableParityInventory } from "./readable-parity.ts";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");
const resourceRoots = ["skills", "design-templates", "craft"] as const;
const retiredIdentity = /Open Design|open-design|\bod\.(?:mode|category|scenario|preview|outputs|inputs|upstream)\b|od:\/\/|@open-design|\.od(?=$|[^A-Za-z0-9_])|__od__|OD_/mu;
const retiredProviderLogos = [
  "anthropic.svg",
  "deepseek.svg",
  "gemini.svg",
  "minimax.svg",
  "moonshot.svg",
  "openai.svg",
  "qwen.svg",
  "xai.svg",
  "xiaomi.svg",
  "zhipu.svg",
] as const;

async function filesBelow(root: string): Promise<readonly string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(root, entry.name);
    return entry.isDirectory() ? filesBelow(entryPath) : [entryPath];
  }));
  return nested.flat().sort();
}

test("preserves resource inventory when product-owned identities are converted", async () => {
  // Given: the bundled runtime resource catalog.
  // When: its machine-consumed inventory is collected.
  const inventory = await collectReadableParityInventory(repoRoot);

  // Then: exact counts remain and the product-owned landing IDs stay in inventory.
  assert.equal(inventory.skills.length, 154);
  assert.equal(inventory.templates.length, 104);
  assert.ok(inventory.templates.includes("readable-landing"));
  assert.ok(inventory.templates.includes("readable-landing-deck"));
});

test("rejects old resource frontmatter and stale generated copies", async () => {
  // Given: every shipped skill, design template, and craft resource.
  const files = (await Promise.all(resourceRoots.map((root) => filesBelow(path.join(repoRoot, root))))).flat();

  // When: product-owned identity and metadata keys are audited.
  const stale: string[] = [];
  for (const file of files) {
    const relativePath = path.relative(repoRoot, file).replaceAll(path.sep, "/");
    if (relativePath.endsWith("/LICENSE") || relativePath.endsWith("/LICENSE.md")) continue;
    const source = await readFile(file, "utf8");
    if (source.includes("\0")) continue;
    if (retiredIdentity.test(source) || relativePath.includes("readable-studio")) stale.push(relativePath);
  }

  // Then: no active source, metadata, path, or generated copy retains it.
  assert.deepEqual(stale, []);
});

test("rejects website-only metadata and malformed code spans in the canonical landing manifest", async () => {
  // Given: the machine-consumed canonical landing manifest.
  const raw = await readFile(
    path.join(repoRoot, "plugins/_official/examples/readable-landing/readable-studio.json"),
    "utf8",
  );
  const manifest: unknown = JSON.parse(raw);
  assert.ok(typeof manifest === "object" && manifest !== null && !Array.isArray(manifest));
  const description = Reflect.get(manifest, "description");
  const localized = Reflect.get(manifest, "description_i18n");
  assert.equal(typeof description, "string");
  assert.ok(typeof localized === "object" && localized !== null && !Array.isArray(localized));
  const englishDescription = Reflect.get(localized, "en");
  assert.equal(typeof englishDescription, "string");

  // When: active distribution residue and malformed empty code spans are inspected.
  const invalidFragments = [description, englishDescription].filter(
    (value) => value.includes("Astro marketing site") || value.includes("``"),
  );

  // Then: canonical metadata contains neither defect.
  assert.deepEqual(invalidFragments, []);
});

test("removes only the unreferenced website-provider logo bundle", async () => {
  // Given: all shipped text under the resource and runtime surfaces.
  const roots = ["design-templates", "plugins", "skills", "apps"] as const;
  const files = (await Promise.all(roots.map((root) => filesBelow(path.join(repoRoot, root))))).flat();

  // When: references to the retired provider-logo bundle are collected.
  const references: string[] = [];
  for (const file of files) {
    if (!/\.(?:css|html|js|json|md|ts|tsx|yaml|yml)$/u.test(file)) continue;
    const source = await readFile(file, "utf8");
    if (source.includes("assets/agents/") || retiredProviderLogos.some((name) => source.includes(`agents/${name}`))) {
      references.push(path.relative(repoRoot, file).replaceAll(path.sep, "/"));
    }
  }

  // Then: no consumer remains and the exact retired directory is absent.
  assert.deepEqual(references, []);
  await assert.rejects(
    () => access(path.join(repoRoot, "design-templates/readable-landing/assets/agents")),
    { code: "ENOENT" },
  );
});

test("regenerates neutral landing and deck examples byte-stably from canonical inputs", async () => {
  // Given: canonical Readable Studio landing and deck inputs.
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "readable-resources-"));
  try {
    const cases = ["readable-landing", "readable-landing-deck"] as const;

    // When: each composer regenerates its example twice from the same source.
    for (const id of cases) {
      const root = path.join(repoRoot, "design-templates", id);
      const first = path.join(temporaryRoot, `${id}-first.html`);
      const second = path.join(temporaryRoot, `${id}-second.html`);
      for (const output of [first, second]) {
        await execFileAsync(
          process.execPath,
          ["--import", "tsx", path.join(root, "scripts", "compose.ts"), path.join(root, "inputs.example.json"), output],
          { cwd: repoRoot },
        );
      }

      // Then: both runs and the checked-in derived copy are byte-identical.
      const [firstSource, secondSource, checkedIn] = await Promise.all([
        readFile(first, "utf8"),
        readFile(second, "utf8"),
        readFile(path.join(root, "example.html"), "utf8"),
      ]);
      assert.equal(firstSource, secondSource, `${id} second regeneration drifted`);
      assert.equal(firstSource, checkedIn, `${id}/example.html is stale`);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
