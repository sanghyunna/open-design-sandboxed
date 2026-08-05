import path from 'node:path';
import {
  createHostedPiBroker,
  type HostedPiBroker,
} from './hosted-pi-broker.js';
import {
  createHostedPiInvocation,
  type HostedPiInvocationOptions,
  type HostedPiRuntimeAdapter,
  type HostedPiRuntimeRequest,
} from './hosted-pi-runtime.js';

export type HostedPiRuntimeAdapterOptions = {
  /** A server-owned writable root for one run's broker socket and session files. */
  runtimeRoot: string;
  /** Resolves the authenticated identity from the server's request composition. */
  resolveUserKey: (request: HostedPiRuntimeRequest) => string;
  packageRoot?: string;
  sessionRoot?: string;
};

function safeRunId(runId: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(runId)) {
    throw new Error('hosted Pi run id is invalid');
  }
  return runId;
}

/**
 * Compose the server-owned hosted Pi broker and package-local invocation.
 * The identity resolver is injected by the authenticated hosted composition;
 * Pi and clients never supply the binding.
 */
export function createHostedPiRuntimeAdapter(
  options: HostedPiRuntimeAdapterOptions,
): HostedPiRuntimeAdapter {
  const runtimeRoot = path.resolve(options.runtimeRoot);
  const sessionRoot = path.resolve(options.sessionRoot ?? path.join(runtimeRoot, 'sessions'));
  return async (request) => {
    const runId = safeRunId(request.runId);
    const userKey = options.resolveUserKey(request);
    const broker: HostedPiBroker = await createHostedPiBroker({
      runtimeRoot,
      binding: {
        userKey,
        runId,
        projectId: request.projectId,
        projectRoot: request.projectRoot,
      },
    });
    try {
      const invocationOptions: HostedPiInvocationOptions = {
        ...(options.packageRoot ? { packageRoot: options.packageRoot } : {}),
        cwd: request.cwd,
        sessionDir: path.join(sessionRoot, runId),
        broker,
        ...(request.model !== undefined ? { model: request.model } : {}),
        ...(request.thinking !== undefined ? { thinking: request.thinking } : {}),
      };
      const invocation = createHostedPiInvocation(invocationOptions);
      return { invocation, close: broker.close };
    } catch (error) {
      await broker.close();
      throw error;
    }
  };
}
