import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: spawnMock,
}));

import { probeIsolatedAgentSupport } from "../src/isolated-process.js";

const temporaryPaths: string[] = [];
const originalPlatform = process.platform;

afterEach(() => {
  spawnMock.mockReset();
  Object.defineProperty(process, "platform", { value: originalPlatform });
  for (const path of temporaryPaths.splice(0)) rmSync(path, { force: true, recursive: true });
});

describe("isolated process capability probe", () => {
  it("fails closed when any declared native capability is missing", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    const directory = mkdtempSync(join(tmpdir(), "od-isolator-probe-"));
    temporaryPaths.push(directory);
    const helperPath = join(directory, "probe.exe");
    writeFileSync(helperPath, "placeholder");

    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as any;
      child.stdout = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
      child.stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
      child.kill = vi.fn();
      queueMicrotask(() => {
        child.stdout.emit("data", JSON.stringify({
          supported: true,
          capabilities: {
            appContainer: true,
            filesystemAcl: false,
            internetClient: true,
            killOnJobClose: true,
            loopbackDenied: true,
          },
        }));
        child.emit("exit", 0);
      });
      return child;
    });

    await expect(probeIsolatedAgentSupport({ helperPath })).resolves.toMatchObject({
      supported: false,
      reason: expect.stringContaining("invalid capability"),
    });
  });
});
