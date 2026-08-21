import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import {
  auditCopySources,
  parseCopyPolicyArgs,
  renderCopyPolicyReport,
} from "./readable-copy-policy.ts";

const APPROVED_DOCTRINE = [
  "Readable Studio starts with source text from existing business material.",
  "AI generation turns that source into a structured first draft.",
  "Office workers then use PowerPoint-like direct editing instead of returning to a prompt for every change.",
  "The result is polished standalone HTML for enterprise AI transformation.",
].join("\n");

describe("Readable Studio copy policy", () => {
  test("classifies approved doctrine by structural pillars", () => {
    const report = auditCopySources([{ path: "brief.md", source: APPROVED_DOCTRINE }]);

    assert.equal(report.ok, true);
    assert.deepEqual(
      report.pillars.map(({ id, present }) => [id, present]),
      [
        ["source-text", true],
        ["ai-generation", true],
        ["direct-editing", true],
        ["standalone-html", true],
        ["office-workers", true],
        ["enterprise-ai-transformation", true],
      ],
    );
    assert.deepEqual(report.retiredClaims, []);
    assert.deepEqual(report.forbiddenDistributionClaims, []);
  });

  test("rejects retired product claims", () => {
    const report = auditCopySources([
      {
        path: "retired.md",
        source: `${APPROVED_DOCTRINE}\nThe open-source Claude Design alternative includes the official Model Router. Join the Readable Studio community as an Readable Studio Fellow.`,
      },
    ]);

    assert.equal(report.ok, false);
    assert.deepEqual(
      [...new Set(report.retiredClaims.map(({ id }) => id))],
      ["claude-alternative", "fellow-program", "community-positioning", "official-router"],
    );
    console.log(renderCopyPolicyReport(report));
  });

  test("rejects forbidden website updater and distribution claims", () => {
    const report = auditCopySources([
      {
        path: "distribution.md",
        source: `${APPROVED_DOCTRINE}\nDownload it from the official product website. The automatic updater installs each release. Linux AppImage and macOS installers are supported.`,
      },
    ]);

    assert.equal(report.ok, false);
    assert.deepEqual(
      [...new Set(report.forbiddenDistributionClaims.map(({ id }) => id))],
      ["product-website", "automatic-updater", "unsupported-distribution"],
    );
  });

  test("allows explicit negation of retired distribution claims", () => {
    const report = auditCopySources([
      {
        path: "boundary.md",
        source: `${APPROVED_DOCTRINE}\nThere is no product website, automatic updater, macOS build, or Linux build.`,
      },
    ]);

    assert.equal(report.ok, true);
    assert.deepEqual(report.forbiddenDistributionClaims, []);
  });

  test("does not let negation in an earlier clause hide a positive claim", () => {
    const report = auditCopySources([
      {
        path: "mixed.md",
        source: `${APPROVED_DOCTRINE}\nNo product website is required; a Linux build is available.`,
      },
    ]);

    assert.equal(report.ok, false);
    assert.deepEqual(
      [...new Set(report.forbiddenDistributionClaims.map(({ id }) => id))],
      ["unsupported-distribution"],
    );
  });

  test("reports missing doctrine without comparing exact prose", () => {
    const report = auditCopySources([{ path: "thin.md", source: "Readable Studio makes documents." }]);

    assert.equal(report.ok, false);
    assert.equal(report.summary.missingPillars, 6);
    assert.equal(report.files[0]?.path, "thin.md");
  });

  test("renders byte-identical reports for unchanged input", () => {
    const input = [{ path: "brief.md", source: APPROVED_DOCTRINE }];

    assert.equal(renderCopyPolicyReport(auditCopySources(input)), renderCopyPolicyReport(auditCopySources(input)));
  });

  test("writes a deterministic audit report", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "readable-copy-policy-"));
    const sourcePath = path.join(root, "brief.md");
    const firstReport = path.join(root, "first.json");
    const secondReport = path.join(root, "second.json");
    try {
      await writeFile(sourcePath, APPROVED_DOCTRINE, "utf8");

      const { runCopyPolicy } = await import("./readable-copy-policy.ts");
      assert.equal(await runCopyPolicy(["audit", "--report", firstReport, sourcePath]), 0);
      assert.equal(await runCopyPolicy(["audit", "--report", secondReport, sourcePath]), 0);
      assert.equal(await readFile(firstReport, "utf8"), await readFile(secondReport, "utf8"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects malformed CLI input", () => {
    assert.throws(() => parseCopyPolicyArgs(["audit", "brief.md"]), /--report/);
    assert.throws(() => parseCopyPolicyArgs(["audit", "--report", "report.json"]), /at least one path/);
    assert.throws(() => parseCopyPolicyArgs(["audit", "--wat", "report.json", "brief.md"]), /unknown option/);
  });
});
