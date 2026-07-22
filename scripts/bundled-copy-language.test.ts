import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkBundledCopyLanguage,
  collectBundledCopyLanguageViolations,
  collectCanonicalCatalogueCopyViolations,
  collectSharedCatalogueCopyPaths,
} from "./check-bundled-copy-language.ts";

test("bundled copy guard rejects Chinese SKILL, preview, and nested side-file copy", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "od-bundled-copy-"));
  try {
    await mkdir(path.join(root, "skills/example"), { recursive: true });
    await mkdir(path.join(root, "design-templates/example/references"), { recursive: true });
    await mkdir(path.join(root, "plugins/_official/examples/example"), { recursive: true });
    await writeFile(
      path.join(root, "skills/example/SKILL.md"),
      "---\nname: example\nzh_name: \u4e2d\u6587\u9ed8\u8ba4\nzh_alias: \u4e2d\u6587\u672a\u6388\u6743\n---\nChinese \u9ed8\u8ba4\u6587\u6848\n",
    );
    await writeFile(path.join(root, "design-templates/example/example.html"), "<p>\u9884\u89c8\u6587\u6848</p>\n");
    await writeFile(path.join(root, "design-templates/example/references/guide.md"), "\u5d4c\u5957\u6587\u6848\n");
    await writeFile(
      path.join(root, "plugins/_official/examples/example/open-design.json"),
      '{"title_i18n":{"zh-CN":"\u4e2d\u6587\u672c\u5730\u5316","ja":"\u65e5\u672c\u8a9e"},"title":"\u9ed8\u8ba4\u6587\u6848"}',
    );

    assert.deepEqual(
      new Set((await collectBundledCopyLanguageViolations(root)).map((violation) => violation.filePath)),
      new Set([
        "skills/example/SKILL.md",
        "design-templates/example/example.html",
        "design-templates/example/references/guide.md",
        "plugins/_official/examples/example/open-design.json",
      ]),
    );
    assert.equal(await checkBundledCopyLanguage(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bundled copy guard permits explicit translations in manifests and reviewed Japanese previews", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "od-bundled-copy-"));
  try {
    await mkdir(path.join(root, "skills/example"), { recursive: true });
    await mkdir(path.join(root, "design-templates/last30days/scripts/lib"), { recursive: true });
    await mkdir(path.join(root, "design-templates/wireframe-sketch"), { recursive: true });
    await mkdir(path.join(root, "plugins/_official/examples/example"), { recursive: true });
    await mkdir(path.join(root, "plugins/_official/examples/sprite-animation"), { recursive: true });
    await mkdir(path.join(root, "plugins/_official/examples/wireframe-sketch"), { recursive: true });
    await writeFile(
      path.join(root, "skills/example/SKILL.md"),
      "---\r\nname: example\r\nzh_name: \u4e2d\u6587\r\nzh_description: \u4e2d\u6587\r\nod:\r\n  example_prompt_i18n:\r\n    zh-CN: \u4e2d\u6587\r\n    zh-TW: \u4e2d\u6587\r\n---\r\nEnglish default\r\n",
    );
    await writeFile(path.join(root, "design-templates/last30days/scripts/lib/xiaohongshu_api.py"), "API = '\u4e2d\u6587'\n");
    await writeFile(path.join(root, "design-templates/wireframe-sketch/example.html"), "<p>\u65e5\u672c\u8a9e</p>\n");
    await writeFile(path.join(root, "plugins/_official/examples/sprite-animation/example.html"), "<p>\u65e5\u672c\u8a9e</p>\n");
    await writeFile(path.join(root, "plugins/_official/examples/wireframe-sketch/example.html"), "<p>\u65e5\u672c\u8a9e</p>\n");
    await writeFile(
      path.join(root, "plugins/_official/examples/example/open-design.json"),
      '{"title_i18n":{"zh-CN":"\u4e2d\u6587","zh-TW":"\u4e2d\u6587","ja":"\u65e5\u672c\u8a9e"}}',
    );

    assert.equal(await checkBundledCopyLanguage(root), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bundled copy guard does not mask arbitrary Japanese locale values outside manifests", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "od-bundled-copy-"));
  try {
    await mkdir(path.join(root, "skills/example"), { recursive: true });
    await writeFile(
      path.join(root, "skills/example/SKILL.md"),
      "---\nname: example\nod:\n  example_prompt_i18n:\n    ja: \u65e5\u672c\u8a9e\n---\nEnglish default\n",
    );
    await writeFile(path.join(root, "skills/example/data.json"), '{"label_i18n":{"ja":"\u65e5\u672c\u8a9e"}}');

    const violations = await collectBundledCopyLanguageViolations(root);
    assert.deepEqual(
      new Set(violations.map((violation) => violation.filePath)),
      new Set(["skills/example/SKILL.md", "skills/example/data.json"]),
    );
    assert.equal(await checkBundledCopyLanguage(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bundled copy guard compares every shared copy's user-visible default content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "od-bundled-copy-"));
  try {
    await mkdir(path.join(root, "plugins/_official/examples/example"), { recursive: true });
    await mkdir(path.join(root, "design-templates/example"), { recursive: true });
    await writeFile(path.join(root, "plugins/_official/examples/example/example.html"), '<html lang="en"><h1>Canonical preview</h1>\n');
    await writeFile(path.join(root, "design-templates/example/example.html"), '<html lang="zh-CN"><h1>Changed preview</h1>\n');

    assert.deepEqual(await collectCanonicalCatalogueCopyViolations(root), [
      {
        canonicalPath: "plugins/_official/examples/example/example.html",
        derivedPath: "design-templates/example/example.html",
        reason: "diverged",
      },
    ]);
    assert.equal(await checkBundledCopyLanguage(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("every current shared catalogue file is classified, including intentionally independent copies", async () => {
  const paths = await collectSharedCatalogueCopyPaths();
  assert.equal(paths.length, 239);
  assert.deepEqual(await collectCanonicalCatalogueCopyViolations(), []);
});
