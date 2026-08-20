import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

import { SIDECAR_MESSAGES } from "@readable-studio/sidecar-proto";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {},
}));

import { PackagedPathAccessError } from "../src/errors.js";
import {
  claimPackagedSingleInstanceLock,
  ensurePackagedNamespacePaths,
  inspectExistingPackagedDesktop,
  verifyPackagedDataRootWritable,
} from "../src/launch.js";

function fakePaths(root: string) {
  return {
    cacheRoot: join(root, "cache"),
    dataRoot: join(root, "data"),
    desktopIdentityPath: join(root, "runtime", "desktop-root.json"),
    desktopLogPath: join(root, "logs", "desktop", "latest.log"),
    desktopLogsRoot: join(root, "logs", "desktop"),
    electronSessionDataRoot: join(root, "user-data", "session"),
    electronUserDataRoot: join(root, "user-data"),
    headlessIdentityPath: join(root, "runtime", "headless-root.json"),
    installationRoot: root,
    logsRoot: join(root, "logs"),
    namespaceRoot: root,
    resourceRoot: join(root, "resources", "readable-studio"),
    runtimeRoot: join(root, "runtime"),
    webIdentityPath: join(root, "runtime", "web-root.json"),
  };
}

describe("verifyPackagedDataRootWritable", () => {
  it("accepts a writable dataRoot", async () => {
    const root = mkdtempSync(join(tmpdir(), "od-packaged-launch-"));
    try {
      const dataRoot = join(root, "namespaces", "release-beta", "data");
      await expect(verifyPackagedDataRootWritable({ dataRoot })).resolves.toBeUndefined();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it.runIf(process.platform === "win32")("rejects an ACL read-only portable root with a clear recovery action", async () => {
    const root = mkdtempSync(join(tmpdir(), "readable-packaged-readonly-"));
    const protectedRoot = join(root, "portable-root");
    const username = userInfo().username;
    mkdirSync(protectedRoot);
    try {
      execFileSync("icacls.exe", [protectedRoot, "/deny", `${username}:(OI)(CI)(W)`]);

      await expect(
        verifyPackagedDataRootWritable({ dataRoot: join(protectedRoot, "ReadableStudioData", "data") }),
      ).rejects.toMatchObject({
        message: expect.stringContaining("Extract Readable Studio to a writable folder"),
        name: "PackagedPathAccessError",
      });
    } finally {
      execFileSync("icacls.exe", [protectedRoot, "/remove:d", username]);
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("wraps low-level mkdir/access failures with a user-actionable error", async () => {
    const root = mkdtempSync(join(tmpdir(), "od-packaged-launch-"));
    try {
      const blocker = join(root, "namespaces", "release-beta");
      mkdirSync(blocker, { recursive: true });
      writeFileSync(join(blocker, "data"), "not a directory");

      let captured: unknown;
      try {
        await verifyPackagedDataRootWritable({ dataRoot: join(blocker, "data") });
      } catch (error) {
        captured = error;
      }

      expect(captured).toBeInstanceOf(PackagedPathAccessError);
      expect((captured as Error).message).toContain("Readable Studio could not create or write to:");
      expect((captured as Error).message).toContain(join(blocker, "data"));
      expect((captured as Error).message).toContain("Current user:");
      expect((captured as Error).message).toContain("Extract Readable Studio to a writable folder");
      expect((captured as Error).message).toContain("security software denied writes");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe("ensurePackagedNamespacePaths", () => {
  it("fails clearly when any exe-adjacent writable root is malformed", async () => {
    const root = mkdtempSync(join(tmpdir(), "readable-packaged-roots-"));
    try {
      const paths = fakePaths(root);
      writeFileSync(paths.cacheRoot, "cache root is a file", "utf8");

      await expect(ensurePackagedNamespacePaths(paths)).rejects.toMatchObject({
        message: expect.stringContaining(paths.cacheRoot),
        name: "PackagedPathAccessError",
      });
      await expect(ensurePackagedNamespacePaths(paths)).rejects.toThrow(/extract Readable Studio to a writable folder/i);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe("inspectExistingPackagedDesktop", () => {
  it("focuses an existing namespace desktop and exits", async () => {
    const root = mkdtempSync(join(tmpdir(), "readable-packaged-inspect-"));
    const requests: unknown[] = [];
    try {
      const result = await inspectExistingPackagedDesktop("release-beta-win", {
        paths: fakePaths(root),
        requestIpc: (async (_ipcPath: string, message: unknown) => {
          requests.push(message);
          if ((message as { type?: string }).type === SIDECAR_MESSAGES.STATUS) {
            return { pid: 1234, state: "running", updatedAt: new Date().toISOString() };
          }
          return { accepted: true };
        }) as typeof import("@readable-studio/sidecar").requestJsonIpc,
      });

      expect(result).toEqual({ action: "exit", reason: "existing-focused" });
      expect(requests).toEqual([{ type: SIDECAR_MESSAGES.STATUS }, { type: SIDECAR_MESSAGES.SHOW }]);
      expect(readFileSync(join(root, "logs", "desktop", "startup.log"), "utf8"))
        .toContain("inspect-found-existing namespace=release-beta-win focus=accepted");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("continues when the desktop cannot be reached", async () => {
    const root = mkdtempSync(join(tmpdir(), "readable-packaged-inspect-"));
    try {
      const result = await inspectExistingPackagedDesktop("release-beta-win", {
        paths: fakePaths(root),
        requestIpc: (async () => {
          throw new Error("pipe closed");
        }) as typeof import("@readable-studio/sidecar").requestJsonIpc,
      });

      expect(result).toEqual({ action: "continue", reason: "inspect-failed" });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("exits without launching a duplicate when focus fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "readable-packaged-inspect-"));
    const logger = { warn: vi.fn() };
    try {
      const result = await inspectExistingPackagedDesktop("release-beta-win", {
        logger,
        paths: fakePaths(root),
        requestIpc: (async (_ipcPath: string, message: unknown) => {
          if ((message as { type?: string }).type === SIDECAR_MESSAGES.STATUS) {
            return { pid: 1234, state: "running", updatedAt: new Date().toISOString() };
          }
          throw new Error("show rejected");
        }) as typeof import("@readable-studio/sidecar").requestJsonIpc,
      });

      expect(result).toEqual({ action: "exit", reason: "existing-focus-failed" });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("focus=failed"));
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe("claimPackagedSingleInstanceLock", () => {
  it("registers a second-instance focus callback when the lock is acquired", () => {
    const listeners = new Map<string, () => void>();
    const app = {
      on: vi.fn((event: string, listener: () => void) => {
        listeners.set(event, listener);
        return app;
      }),
      quit: vi.fn(),
      requestSingleInstanceLock: vi.fn(() => true),
    };
    const focusExisting = vi.fn();

    expect(claimPackagedSingleInstanceLock(app, focusExisting)).toBe(true);
    listeners.get("second-instance")?.();

    expect(app.requestSingleInstanceLock).toHaveBeenCalledTimes(1);
    expect(app.on).toHaveBeenCalledWith("second-instance", expect.any(Function));
    expect(app.quit).not.toHaveBeenCalled();
    expect(focusExisting).toHaveBeenCalledTimes(1);
  });

  it("quits the duplicate process before packaged sidecars start when the lock is held", () => {
    const app = {
      on: vi.fn(),
      quit: vi.fn(),
      requestSingleInstanceLock: vi.fn(() => false),
    };

    expect(claimPackagedSingleInstanceLock(app, vi.fn())).toBe(false);

    expect(app.requestSingleInstanceLock).toHaveBeenCalledTimes(1);
    expect(app.quit).toHaveBeenCalledTimes(1);
    expect(app.on).not.toHaveBeenCalled();
  });
});
