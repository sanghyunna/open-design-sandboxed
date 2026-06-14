import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const USER_DATA_DIR = join("C:", "Users", "Fred", "AppData", "Roaming", "Open Design");

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => {
      if (name === "userData") return USER_DATA_DIR;
      throw new Error(`unexpected getPath(${name})`);
    },
    getAppPath: () => join("C:", "Program Files", "Open Design", "resources", "app"),
  },
}));

import {
  PACKAGED_CONFIG_PATH_ENV,
  readPackagedConfig,
  resolveDefaultPackagedNodeCommandRelativePath,
} from "../src/config.js";

describe("resolveDefaultPackagedNodeCommandRelativePath", () => {
  it("uses the bundled node.exe path on Windows", () => {
    expect(resolveDefaultPackagedNodeCommandRelativePath("win32")).toBe("open-design/bin/node.exe");
  });

  it("uses the bundled node path on Linux and macOS", () => {
    expect(resolveDefaultPackagedNodeCommandRelativePath("linux")).toBe("open-design/bin/node");
    expect(resolveDefaultPackagedNodeCommandRelativePath("darwin")).toBe("open-design/bin/node");
  });
});

// Each case writes a minimal packaged config to a temp file and points
// OD_PACKAGED_CONFIG_PATH at it, so readPackagedConfig resolves the same raw
// config a shipped artifact would, while `app.getPath("userData")` is mocked
// and `process.execPath` is overridable to assert the exe-adjacent fallback.
describe("readPackagedConfig namespaceBaseRoot resolution", () => {
  let configDir = "";
  let restoreEnv: () => void = () => {};
  let restoreExecPath: () => void = () => {};
  let restoreResourcesPath: () => void = () => {};

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "od-packaged-config-"));
    const previousEnv = process.env[PACKAGED_CONFIG_PATH_ENV];
    restoreEnv = () => {
      if (previousEnv == null) delete process.env[PACKAGED_CONFIG_PATH_ENV];
      else process.env[PACKAGED_CONFIG_PATH_ENV] = previousEnv;
    };
    // resolvePackagedWebStandaloneRoot/nodeCommand probe process.resourcesPath;
    // point it at an empty dir so neither resolves to a real bundled path.
    const previousResourcesPath = process.resourcesPath;
    Object.defineProperty(process, "resourcesPath", { value: configDir, configurable: true });
    restoreResourcesPath = () => {
      Object.defineProperty(process, "resourcesPath", { value: previousResourcesPath, configurable: true });
    };
  });

  afterEach(() => {
    restoreEnv();
    restoreExecPath();
    restoreResourcesPath();
    rmSync(configDir, { force: true, recursive: true });
  });

  function writeConfig(raw: Record<string, unknown>): void {
    const configPath = join(configDir, "open-design-config.json");
    writeFileSync(configPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    process.env[PACKAGED_CONFIG_PATH_ENV] = configPath;
  }

  function stubExecPath(execPath: string): void {
    const previous = process.execPath;
    Object.defineProperty(process, "execPath", { value: execPath, configurable: true });
    restoreExecPath = () => {
      Object.defineProperty(process, "execPath", { value: previous, configurable: true });
    };
  }

  it("falls back to an exe-adjacent OpenDesignData root when portable and no explicit root", async () => {
    const exeDir = join("D:", "Portable", "Open Design");
    stubExecPath(join(exeDir, "Open Design.exe"));
    writeConfig({ namespace: "rg", portable: true });

    const config = await readPackagedConfig();

    expect(config.portable).toBe(true);
    expect(config.namespaceBaseRoot).toBe(join(exeDir, "OpenDesignData", "namespaces"));
    // The portable root must never touch the mocked userData directory.
    expect(config.namespaceBaseRoot.startsWith(USER_DATA_DIR)).toBe(false);
  });

  it("derives the portable root from dirname(process.execPath)", async () => {
    const exeDir = join("E:", "tools", "od-extract");
    stubExecPath(join(exeDir, "Open Design.exe"));
    writeConfig({ namespace: "rg", portable: true });

    const config = await readPackagedConfig();

    expect(dirname(dirname(config.namespaceBaseRoot))).toBe(exeDir);
  });

  it("falls back to the userData root when not portable", async () => {
    stubExecPath(join("D:", "Portable", "Open Design", "Open Design.exe"));
    writeConfig({ namespace: "rg" });

    const config = await readPackagedConfig();

    expect(config.portable).toBe(false);
    expect(config.namespaceBaseRoot).toBe(join(USER_DATA_DIR, "namespaces"));
  });

  it("treats portable: false the same as a non-portable build", async () => {
    stubExecPath(join("D:", "Portable", "Open Design", "Open Design.exe"));
    writeConfig({ namespace: "rg", portable: false });

    const config = await readPackagedConfig();

    expect(config.portable).toBe(false);
    expect(config.namespaceBaseRoot).toBe(join(USER_DATA_DIR, "namespaces"));
  });

  it("lets an explicit namespaceBaseRoot win even when portable", async () => {
    const explicitRoot = join("F:", "od-data", "namespaces");
    stubExecPath(join("D:", "Portable", "Open Design", "Open Design.exe"));
    writeConfig({ namespace: "rg", namespaceBaseRoot: explicitRoot, portable: true });

    const config = await readPackagedConfig();

    expect(config.portable).toBe(true);
    expect(config.namespaceBaseRoot).toBe(explicitRoot);
  });

  it("lets an explicit namespaceBaseRoot win for non-portable builds (unchanged behavior)", async () => {
    const explicitRoot = join("F:", "od-data", "namespaces");
    stubExecPath(join("D:", "Portable", "Open Design", "Open Design.exe"));
    writeConfig({ namespace: "rg", namespaceBaseRoot: explicitRoot });

    const config = await readPackagedConfig();

    expect(config.portable).toBe(false);
    expect(config.namespaceBaseRoot).toBe(explicitRoot);
  });

  it("resolves the default bundled node command when it exists under resources", async () => {
    const relativeNode = resolveDefaultPackagedNodeCommandRelativePath(process.platform);
    const nodePath = join(configDir, relativeNode);
    mkdirSync(dirname(nodePath), { recursive: true });
    writeFileSync(nodePath, "fake node\n", "utf8");
    writeConfig({ namespace: "rg" });

    const config = await readPackagedConfig();

    expect(config.nodeCommand).toBe(nodePath);
  });
});
