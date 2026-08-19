import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  assertIdentityAuditPassed,
  auditIdentitySources,
  formatIdentityAuditFailure,
  type IdentityBaselineEntry,
} from "./readable-identity-audit.ts";

const emptyBaseline: IdentityBaselineEntry[] = [];

describe("readable identity audit", () => {
  test("rejects unclassified active identity residue with deterministic diagnostics", () => {
    const report = auditIdentitySources({
      baseline: emptyBaseline,
      scope: "active",
      sources: [
        {
          path: "apps/example/src/identity.ts",
          source: "Open Design open-design OD_TEST od://app @open-design/pkg .od __od__",
        },
      ],
    });

    assert.equal(report.summary.unclassified, 7);
    const diagnostic = formatIdentityAuditFailure(report);
    assert.match(diagnostic, /apps\/example\/src\/identity\.ts/);
    assert.match(diagnostic, /Open Design, open-design, OD_, od:\/\/, @open-design, \.od, __od__/);
    assert.throws(() => assertIdentityAuditPassed(report), { message: diagnostic });
    console.log(diagnostic);
  });

  test("allows explicitly classified history and license residue", () => {
    const report = auditIdentitySources({
      baseline: emptyBaseline,
      scope: "all",
      sources: [
        { path: "CHANGELOG.md", source: "Open Design shipped under Apache-2.0." },
        { path: "specs/change/closed/identity.md", source: "The old package was @open-design/web." },
        { path: "LICENSE", source: "Copyright Open Design contributors" },
      ],
    });

    assert.equal(report.summary.unclassified, 0);
    assert.equal(report.classCounts["immutable history/provenance"], 2);
    assert.equal(report.classCounts["vendor/license"], 1);
    assert.doesNotThrow(() => assertIdentityAuditPassed(report));
  });

  test("rejects replacement residue even when the aggregate token count is unchanged", () => {
    const original = auditIdentitySources({
      baseline: emptyBaseline,
      scope: "active",
      sources: [{ path: "apps/example/src/identity.ts", source: "const product = 'Open Design';" }],
    });
    const baseline = original.entries.map(({ firstLine: _firstLine, ...entry }) => entry);
    const replacement = auditIdentitySources({
      baseline,
      scope: "active",
      sources: [{ path: "apps/example/src/identity.ts", source: "const title = 'Open Design';" }],
    });

    assert.equal(replacement.summary.matches, 1);
    assert.equal(replacement.summary.unclassified, 1);
  });

  test("produces byte-stable reports for identical inputs", () => {
    const options = {
      baseline: emptyBaseline,
      scope: "all" as const,
      sources: [{ path: "CHANGELOG.md", source: "Open Design\n" }],
    };

    assert.equal(JSON.stringify(auditIdentitySources(options)), JSON.stringify(auditIdentitySources(options)));
  });
});
