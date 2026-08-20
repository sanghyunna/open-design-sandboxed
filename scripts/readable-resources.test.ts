import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { collectReadableParityInventory } from "./readable-parity.ts";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");
const resourceRoots = ["skills", "design-templates", "craft"] as const;
const retiredIdentity = /Open Design|open-design|\bod\.(?:mode|category|scenario|preview|outputs|inputs|upstream)\b|^od:/mu;

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

  // Then: exact counts remain and only the product-owned landing IDs move.
  assert.equal(inventory.skills.length, 154);
  assert.equal(inventory.templates.length, 104);
  assert.ok(inventory.templates.includes("readable-landing"));
  assert.ok(inventory.templates.includes("readable-landing-deck"));
  assert.ok(!inventory.templates.includes("open-design-landing"));
  assert.ok(!inventory.templates.includes("open-design-landing-deck"));
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
    if (retiredIdentity.test(source) || relativePath.includes("open-design")) stale.push(relativePath);
  }

  // Then: no active source, metadata, path, or generated copy retains it.
  assert.deepEqual(stale, []);
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
