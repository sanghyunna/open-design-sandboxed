import {
  READABLE_STUDIO_HOST_GLOBAL,
  READABLE_STUDIO_HOST_VERSION,
  type ReadableStudioHostBridge,
  type ReadableStudioHostGlobalScope,
  type ReadableStudioHostUpdaterStatusSnapshot,
} from "./index.js";

export type MockReadableStudioHost = Partial<Omit<ReadableStudioHostBridge, "capture" | "client" | "pdf" | "pet" | "project" | "shell" | "updater">> & {
  browser?: Partial<ReadableStudioHostBridge["browser"]>;
  capture?: Partial<ReadableStudioHostBridge["capture"]>;
  client?: Partial<ReadableStudioHostBridge["client"]>;
  pdf?: Partial<ReadableStudioHostBridge["pdf"]>;
  pet?: Partial<ReadableStudioHostBridge["pet"]>;
  project?: Partial<ReadableStudioHostBridge["project"]>;
  shell?: Partial<ReadableStudioHostBridge["shell"]>;
  updater?: Partial<ReadableStudioHostBridge["updater"]>;
};

export type MockReadableStudioHostOptions = {
  host?: MockReadableStudioHost;
  scope?: ReadableStudioHostGlobalScope;
};

function defaultHost(): ReadableStudioHostBridge {
  const updaterStatus: ReadableStudioHostUpdaterStatusSnapshot = {
    arch: "arm64",
    capabilities: {
      canApplyInPlace: false,
      canDownload: true,
      canOpenInstaller: true,
      requiresManualInstall: true,
    },
    channel: "beta",
    currentVersion: "1.0.0-beta.0",
    enabled: true,
    mode: "package-launcher",
    platform: "darwin",
    state: "idle",
    supported: true,
  };
  return {
    version: READABLE_STUDIO_HOST_VERSION,
    browser: {
      clearData: async () => ({ ok: true }),
    },
    capture: {
      page: async () => ({ ok: true, dataUrl: "data:image/png;base64,", h: 1, w: 1 }),
    },
    client: {
      type: "desktop",
      platform: "test",
    },
    shell: {
      openExternal: async () => ({ ok: true }),
      openPath: async () => ({ ok: true }),
    },
    project: {
      pickAndImport: async () => ({
        ok: true,
        projectId: "project-test",
        conversationId: "conversation-test",
        entryFile: "index.html",
      }),
      pickAndReplaceWorkingDir: async () => ({
        ok: true,
        baseDir: "/tmp/open-design-test",
        entryFile: null,
      }),
    },
    pdf: {
      print: async () => ({ ok: true }),
    },
    pet: {
      setVisible: () => undefined,
    },
    updater: {
      check: async () => updaterStatus,
      download: async () => updaterStatus,
      install: async () => updaterStatus,
      quit: async () => ({ ok: true }),
      status: async () => updaterStatus,
      subscribe: () => () => undefined,
    },
  };
}

export function createMockReadableStudioHost(overrides: MockReadableStudioHost = {}): ReadableStudioHostBridge {
  const base = defaultHost();
  return {
    ...base,
    ...overrides,
    browser: { ...base.browser, ...overrides.browser },
    capture: { ...base.capture, ...overrides.capture },
    client: { ...base.client, ...overrides.client },
    shell: { ...base.shell, ...overrides.shell },
    project: { ...base.project, ...overrides.project },
    pdf: { ...base.pdf, ...overrides.pdf },
    pet: { ...base.pet, ...overrides.pet },
    updater: { ...base.updater, ...overrides.updater },
  };
}

export function installMockReadableStudioHost(options: MockReadableStudioHostOptions = {}): () => void {
  const scope = (options.scope ?? globalThis) as ReadableStudioHostGlobalScope;
  const host = createMockReadableStudioHost(options.host);
  const windowValue = scope.window;
  const targets = [
    scope,
    ...(typeof windowValue === "object" && windowValue != null && windowValue !== scope
      ? [windowValue as ReadableStudioHostGlobalScope]
      : []),
  ];
  const previous = targets.map((target) => ({
    had: Object.prototype.hasOwnProperty.call(target, READABLE_STUDIO_HOST_GLOBAL),
    target,
    value: target[READABLE_STUDIO_HOST_GLOBAL],
  }));

  for (const target of targets) {
    Object.defineProperty(target, READABLE_STUDIO_HOST_GLOBAL, {
      configurable: true,
      value: host,
      writable: true,
    });
  }

  return () => {
    for (const entry of previous) {
      if (entry.had) {
        Object.defineProperty(entry.target, READABLE_STUDIO_HOST_GLOBAL, {
          configurable: true,
          value: entry.value,
          writable: true,
        });
      } else {
        delete entry.target[READABLE_STUDIO_HOST_GLOBAL];
      }
    }
  };
}
