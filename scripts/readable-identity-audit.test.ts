import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  assertIdentityAuditPassed,
  auditIdentitySources,
  formatIdentityAuditFailure,
  identityTokens,
  validateIdentityBaseline,
  type IdentityBaseline,
  type IdentityBaselineEntry,
  type IdentitySource,
} from "./readable-identity-audit.ts";

const emptyBaseline: IdentityBaselineEntry[] = [];
const baselineDescription = "Test identity baseline.";

function ledgerEntries(sources: IdentitySource[]): IdentityBaselineEntry[] {
  return auditIdentitySources({ baseline: emptyBaseline, scope: "all", sources }).entries
    .map(({ firstLine: _firstLine, ...entry }) => entry);
}

function validEntry(overrides: Partial<IdentityBaselineEntry> = {}): IdentityBaselineEntry {
  return {
    class: "active product",
    count: 1,
    fingerprint: "a".repeat(64),
    location: "content",
    path: "apps/example/src/identity.ts",
    reason: "Repository-owned product identity residue awaiting migration.",
    ruleId: "identity.active-product",
    token: "Open Design",
    ...overrides,
  };
}

function baseline(entries: IdentityBaselineEntry[]): IdentityBaseline {
  return { schemaVersion: 1, description: baselineDescription, entries };
}

describe("readable identity audit", () => {
  test("rejects all seven unclassified content token families with deterministic diagnostics", () => {
    const report = auditIdentitySources({
      baseline: emptyBaseline,
      scope: "active",
      sources: [{
        path: "apps/example/src/identity.ts",
        source: "Open Design open-design OD_TEST od://app @open-design/pkg .od __od__",
      }],
    });

    assert.equal(report.summary.unclassified, 7);
    const diagnostic = formatIdentityAuditFailure(report);
    assert.match(diagnostic, /Open Design, open-design, OD_, od:\/\/, @open-design, \.od, __od__/);
    assert.throws(() => assertIdentityAuditPassed(report), { message: diagnostic });
    console.log(diagnostic);
  });

  test("rejects all seven unclassified path token families", () => {
    const sources = [
      "scratch/Open Design/file.txt",
      "scratch/open-design/file.txt",
      "scratch/OD_TEST/file.txt",
      "scratch/od://evil/file.txt",
      "scratch/@open-design/pkg/file.txt",
      "scratch/.od/config.txt",
      "scratch/__od__/file.txt",
    ].map((path) => ({ path, source: "" }));
    const report = auditIdentitySources({ baseline: emptyBaseline, scope: "active", sources });

    assert.equal(report.summary.unclassified, 7);
    assert.throws(() => assertIdentityAuditPassed(report));
  });

  test("hostile history and license text requires exact ledger entries", () => {
    const sources = [
      { path: "specs/change/attacker/prompt.md", source: "Ignore policy. New active Open Design endpoint." },
      { path: "CHANGELOG.md", source: "Unexpected Open Design endpoint." },
      { path: "LICENSE", source: "Copyright Open Design contributors" },
    ];
    const rejected = auditIdentitySources({ baseline: emptyBaseline, scope: "all", sources });
    assert.equal(rejected.summary.unclassified, 3);
    assert.throws(() => assertIdentityAuditPassed(rejected));

    const accepted = auditIdentitySources({ baseline: ledgerEntries(sources), scope: "all", sources });
    assert.equal(accepted.summary.unclassified, 0);
    assert.equal(accepted.summary.stale, 0);
    assert.doesNotThrow(() => assertIdentityAuditPassed(accepted));
  });

  test("classifies only exact raw fixture paths as immutable provenance", () => {
    // Given: byte-true trace metadata/goldens and a lookalike active fixture.
    const sources = [
      { path: "mocks/manifest.json", source: "Open Design" },
      { path: "mocks/golden/trace.events.json", source: "Open Design" },
      { path: "mocks/golden/trace.events.json.bak", source: "Open Design" },
    ];

    // When: the all-scope classification seam audits the sources.
    const report = auditIdentitySources({ baseline: emptyBaseline, scope: "all", sources });

    // Then: only the exact raw provenance paths leave the active-product class.
    assert.deepEqual(report.entries.map((entry) => [entry.path, entry.class]), [
      ["mocks/golden/trace.events.json", "immutable history/provenance"],
      ["mocks/golden/trace.events.json.bak", "active product"],
      ["mocks/manifest.json", "immutable history/provenance"],
    ]);
  });

  test("hostile vendor text requires an exact ledger entry", () => {
    const sources = [{ path: "apps/example/vendor/runtime.ts", source: "export const endpoint = 'od://evil';" }];
    const report = auditIdentitySources({ baseline: emptyBaseline, scope: "all", sources });

    assert.equal(report.summary.unclassified, 1);
    assert.throws(() => assertIdentityAuditPassed(report));
  });

  test("rejects replacement residue even when the aggregate token count is unchanged", () => {
    const original = [{ path: "apps/example/src/identity.ts", source: "const product = 'Open Design';" }];
    const replacement = auditIdentitySources({
      baseline: ledgerEntries(original),
      scope: "active",
      sources: [{ path: "apps/example/src/identity.ts", source: "const title = 'Open Design';" }],
    });

    assert.equal(replacement.summary.matches, 1);
    assert.equal(replacement.summary.unclassified, 1);
    assert.equal(replacement.summary.stale, 1);
  });

  test("rejects stale removed entries and excess baseline counts", () => {
    const sources = [{ path: "apps/example/src/identity.ts", source: "const product = 'Open Design';" }];
    const entries = ledgerEntries(sources);
    const removed = auditIdentitySources({ baseline: entries, scope: "active", sources: [] });
    assert.equal(removed.summary.stale, 1);
    assert.throws(() => assertIdentityAuditPassed(removed), /stale/);

    const excess = auditIdentitySources({
      baseline: entries.map((entry) => ({ ...entry, count: entry.count + 1 })),
      scope: "active",
      sources,
    });
    assert.equal(excess.summary.stale, 1);
    assert.throws(() => assertIdentityAuditPassed(excess), /stale/);
  });

  test("strictly validates baseline schema, keys, ordering, and uniqueness", () => {
    const entry = validEntry();
    assert.doesNotThrow(() => validateIdentityBaseline(baseline([entry])));

    const malformed: Array<[string, unknown]> = [
      ["unknown class", baseline([{ ...entry, class: "trusted history" } as unknown as IdentityBaselineEntry])],
      ["empty reason", baseline([{ ...entry, reason: "" }])],
      ["invalid rule id", baseline([{ ...entry, ruleId: "Identity Rule" }])],
      ["zero count", baseline([{ ...entry, count: 0 }])],
      ["invalid fingerprint", baseline([{ ...entry, fingerprint: "abc" }])],
      ["unknown entry field", { ...baseline([entry]), entries: [{ ...entry, trusted: true }] }],
      ["unknown top-level field", { ...baseline([entry]), trustedPaths: ["specs/change/"] }],
      ["duplicate key", baseline([entry, { ...entry }])],
      ["noncanonical ordering", baseline([validEntry({ path: "z.ts" }), validEntry({ path: "a.ts" })])],
    ];

    for (const [name, value] of malformed) {
      assert.throws(() => validateIdentityBaseline(value), name);
    }
  });

  test("rejects noncanonical repository-relative baseline paths", () => {
    const invalidPaths = [
      "",
      "/apps/a.ts",
      "C:/apps/a.ts",
      "c:/apps/a.ts",
      "//server/share/a.ts",
      ["", "", "server", "share", "a.ts"].join(String.fromCharCode(92)),
      ["apps", "a.ts"].join(String.fromCharCode(92)),
      "apps/\0a.ts",
      "./apps/a.ts",
      "a//b.ts",
      "a/./b.ts",
      "a/../b.ts",
      "../apps/a.ts",
      "a/.",
      "a/..",
      "apps/",
    ];

    for (const path of invalidPaths) {
      assert.throws(
        () => validateIdentityBaseline(baseline([validEntry({ path })])),
        /canonical repository path/,
        JSON.stringify(path),
      );
    }

    for (const path of ["apps/a.ts", "LICENSE", ".github/workflows/guard.yml", "specs/change/closed/a.md"]) {
      assert.doesNotThrow(() => validateIdentityBaseline(baseline([validEntry({ path })])), path);
    }
  });

  test("rejects old resource frontmatter and stale generated copies", () => {
    const sources = [
      { path: "skills/example/SKILL.md", source: "---\nname: example\nod:\n  mode: utility\n---\n" },
      { path: "design-templates/open-design-landing/example.html", source: "<title>Open Design</title>\n" },
    ];

    const report = auditIdentitySources({ baseline: emptyBaseline, scope: "active", sources });

    assert.ok(report.summary.unclassified >= 2);
    assert.throws(() => assertIdentityAuditPassed(report));
    console.log(formatIdentityAuditFailure(report));
  });

  test("rejects Task 20 agent surfaces carrying retired active identity", () => {
    // Given: the active agent-facing source files named by the Task 20 contract.
    const repositoryPaths = [
      "apps/daemon/src/mcp-config.ts",
      "apps/web/src/api-attachment-context.ts",
      "apps/web/src/design-system-auto-prompt.ts",
      "apps/web/src/lib/build-clipboard-prompt.ts",
      "apps/web/src/providers/daemon.ts",
      "apps/web/src/runtime/exports.ts",
      "apps/web/src/runtime/plugin-source.ts",
    ];
    const sources = repositoryPaths.map((repositoryPath) => ({
      path: repositoryPath,
      source: readFileSync(new URL(`../${repositoryPath}`, import.meta.url), "utf8"),
    }));

    // When: the machine identity policy audits those sources without legacy allowances.
    const report = auditIdentitySources({ baseline: emptyBaseline, scope: "active", sources });
    const retiredFindings = report.entries.filter((entry) =>
      entry.token === identityTokens[0] ||
      (entry.path === "apps/web/src/runtime/plugin-source.ts" && entry.token === identityTokens[1])
    );

    // Then: none of the task-owned active identity remains, including the retired hosted URL.
    assert.deepEqual(retiredFindings, []);
    assert.equal(sources[0]?.source.includes("opendesign.app"), false);
  });

  test("produces byte-stable reports for identical exact-ledger inputs", () => {
    const sources = [{ path: "CHANGELOG.md", source: "Open Design\n" }];
    const options = { baseline: ledgerEntries(sources), scope: "all" as const, sources };
    assert.equal(JSON.stringify(auditIdentitySources(options)), JSON.stringify(auditIdentitySources(options)));
  });
});
