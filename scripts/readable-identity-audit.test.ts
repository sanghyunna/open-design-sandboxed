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
    class: "immutable history/provenance",
    count: 1,
    fingerprint: "a".repeat(64),
    location: "content",
    path: "CHANGELOG.md",
    reason: "Truthful immutable history or raw provenance retained without rewriting.",
    ruleId: "identity.immutable-history-provenance",
    token: identityTokens[0],
    ...overrides,
  };
}

function activeEntry(overrides: Partial<IdentityBaselineEntry> = {}): IdentityBaselineEntry {
  return {
    class: "active product",
    count: 1,
    fingerprint: "b".repeat(64),
    location: "content",
    path: "README.md",
    reason: "Repository-owned product identity residue awaiting migration.",
    ruleId: "identity.active-product",
    token: identityTokens[0],
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
        source: identityTokens.map((token) => token === identityTokens[2] ? `${token}TEST` : token).join(" "),
      }],
    });

    assert.equal(report.summary.unclassified, 7);
    const diagnostic = formatIdentityAuditFailure(report);
    for (const token of identityTokens) assert.ok(diagnostic.includes(token), token);
    assert.throws(() => assertIdentityAuditPassed(report), { message: diagnostic });
    console.log(diagnostic);
  });

  test("rejects all seven unclassified path token families", () => {
    const sources = identityTokens.map((token) => ({
      path: `scratch/${token === identityTokens[2] ? `${token}TEST` : token}/file.txt`,
      source: "",
    }));
    const report = auditIdentitySources({ baseline: emptyBaseline, scope: "active", sources });

    assert.equal(report.summary.unclassified, 7);
    assert.throws(() => assertIdentityAuditPassed(report));
  });

  test("allows retired identity only on exact immutable history and license paths", () => {
    const immutableSources = [
      { path: "specs/change/attacker/prompt.md", source: `Historical ${identityTokens[0]} record.` },
      { path: "CHANGELOG.md", source: `Historical ${identityTokens[0]} release.` },
      { path: "LICENSE", source: `Copyright ${identityTokens[0]} contributors` },
    ];
    const accepted = auditIdentitySources({ baseline: emptyBaseline, scope: "all", sources: immutableSources });
    assert.equal(accepted.summary.unclassified, 0);
    assert.doesNotThrow(() => assertIdentityAuditPassed(accepted));

    const active = auditIdentitySources({
      baseline: emptyBaseline,
      scope: "all",
      sources: [{ path: "docs/current.md", source: immutableSources[0]!.source }],
    });
    assert.equal(active.summary.unclassified, 1);
    assert.throws(() => assertIdentityAuditPassed(active));
  });

  test("classifies only exact raw fixture paths as immutable provenance", () => {
    // Given: byte-true trace metadata/goldens and a lookalike active fixture.
    const sources = [
      { path: "mocks/manifest.json", source: identityTokens[0] },
      { path: "mocks/golden/trace.events.json", source: identityTokens[0] },
      { path: "mocks/golden/trace.events.json.bak", source: identityTokens[0] },
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

  test("allows verbatim vendor identity only below an exact vendor path", () => {
    const source = `export const endpoint = '${identityTokens[3]}evil';`;
    const vendor = auditIdentitySources({
      baseline: emptyBaseline,
      scope: "all",
      sources: [{ path: "apps/example/vendor/runtime.ts", source }],
    });
    assert.equal(vendor.summary.unclassified, 0);

    const active = auditIdentitySources({
      baseline: emptyBaseline,
      scope: "all",
      sources: [{ path: "apps/example/runtime.ts", source }],
    });
    assert.equal(active.summary.unclassified, 1);
  });

  test("rejects replacement residue even when the aggregate token count is unchanged", () => {
    const original = [{ path: "apps/example/src/identity.ts", source: `const product = '${identityTokens[0]}';` }];
    const replacement = auditIdentitySources({
      baseline: ledgerEntries(original),
      scope: "active",
      sources: [{ path: "apps/example/src/identity.ts", source: `const title = '${identityTokens[0]}';` }],
    });

    assert.equal(replacement.summary.matches, 1);
    assert.equal(replacement.summary.unclassified, 1);
    assert.equal(replacement.summary.stale, 1);
  });

  test("rejects stale removed entries and excess baseline counts", () => {
    const sources = [{ path: "apps/example/src/identity.ts", source: `const product = '${identityTokens[0]}';` }];
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
      ["active residue allowance", baseline([activeEntry()])],
      ["machine residue allowance", baseline([validEntry({ class: "machine contract to migrate" })])],
      ["generated residue allowance", baseline([validEntry({ class: "generated derivative" })])],
      ["deletion residue allowance", baseline([validEntry({ class: "deletion target" })])],
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

    for (const path of ["CHANGELOG.md", "specs/change/closed/a.md"]) {
      assert.doesNotThrow(() => validateIdentityBaseline(baseline([validEntry({ path })])), path);
    }
  });

  test("rejects old resource frontmatter and stale generated copies", () => {
    const retiredFrontmatter = ["o", "d", ":"].join("");
    const retiredTemplatePath = `design-templates/${identityTokens[1]}-landing/example.html`;
    const sources = [
      { path: "skills/example/SKILL.md", source: `---\nname: example\n${retiredFrontmatter}\n  mode: utility\n---\n` },
      { path: retiredTemplatePath, source: `<title>${identityTokens[0]}</title>\n` },
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

  test("rejects old repository targets", () => {
    const repositoryPaths = [
      ".claude-plugin/marketplace.json",
      ".claude/commands/readable-contribute.md",
      ".claude/skills/readable-contribute/SKILL.md",
      ".claude/skills/readable-contribute/scripts/config.sh",
      ".github/ISSUE_TEMPLATE/bug-report.yml",
      ".github/ISSUE_TEMPLATE/config.yml",
      ".github/ISSUE_TEMPLATE/feature-request.yml",
      ".github/pull_request_template.md",
      ".vaunt/config.yaml",
      "CONTRIBUTING.md",
      "MAINTAINERS.md",
      "README.md",
      "docs/skills-contributing.md",
      "package.json",
    ];
    const retiredSlug = ["open", "design"].join("-");
    const retiredShort = ["o", "d"].join("");
    const retiredTargets = [
      `sanghyunna/${retiredSlug}-sandboxed`,
      `nexu-io/${retiredSlug}`,
      `${retiredShort}-contribute`,
      `${retiredShort.toUpperCase()}_CONTRIBUTE`,
      `.${retiredShort}-contrib`,
      `${retiredShort}-contrib-work`,
    ];

    for (const repositoryPath of repositoryPaths) {
      const source = readFileSync(new URL(`../${repositoryPath}`, import.meta.url), "utf8");
      for (const retiredTarget of retiredTargets) {
        assert.equal(source.includes(retiredTarget), false, `${repositoryPath}: ${retiredTarget}`);
      }
    }

    const packageManifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { bugs?: { url?: string }; homepage?: string; repository?: { url?: string } };
    assert.equal(packageManifest.repository?.url, "git+https://github.com/sanghyunna/readable-studio.git");
    assert.equal(packageManifest.homepage, "https://github.com/sanghyunna/readable-studio#readme");
    assert.equal(packageManifest.bugs?.url, "https://github.com/sanghyunna/readable-studio/issues");
  });

  test("produces byte-stable reports for identical exact-ledger inputs", () => {
    const sources = [{ path: "CHANGELOG.md", source: `${identityTokens[0]}\n` }];
    const options = { baseline: ledgerEntries(sources), scope: "all" as const, sources };
    assert.equal(JSON.stringify(auditIdentitySources(options)), JSON.stringify(auditIdentitySources(options)));
  });
});
