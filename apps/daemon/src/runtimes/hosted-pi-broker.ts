import { createServer, type Server, type Socket } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  existsSync,
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  opendirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import path from 'node:path';
import { hostedPiBrokerExtensionPath } from './hosted-pi-runtime.js';

export const HOSTED_PI_BROKER_TOOL_NAME = 'od_hosted_broker';
export const HOSTED_PI_BROKER_ENDPOINTS = [
  '/api/projects/:id/files',
  '/api/projects/:id/files/*',
] as const;
export const HOSTED_PI_BROKER_OPERATIONS = [
  'project:file:list',
  'project:file:read',
  'project:file:write',
] as const;

export type HostedPiBrokerOperation = (typeof HOSTED_PI_BROKER_OPERATIONS)[number];

export type HostedPiBinding = {
  /** Server-authenticated identity; never accepted from a broker request. */
  userKey: string;
  /** Daemon-created run identifier. */
  runId: string;
  /** Daemon-resolved project identifier. */
  projectId: string;
  /** Daemon-resolved project root. */
  projectRoot: string;
  /** Optional server-owned narrowing of the fixed endpoint set. */
  allowedEndpoints?: readonly string[];
  /** Optional server-owned narrowing of the fixed operation set. */
  allowedOperations?: readonly HostedPiBrokerOperation[];
};

export type HostedPiBrokerGrant = {
  token: string;
  userKey: string;
  runId: string;
  projectId: string;
  projectRoot: string;
  allowedEndpoints: readonly string[];
  allowedOperations: readonly HostedPiBrokerOperation[];
};

export type HostedPiBrokerRequest = {
  token: string;
  operation: string;
  path?: string;
  content?: string;
};

export type HostedPiBrokerResponse =
  | { ok: true; operation: HostedPiBrokerOperation; content?: string; entries?: string[] }
  | { ok: false; code: string; message: string };

export type HostedPiBroker = {
  grant: HostedPiBrokerGrant;
  token: string;
  socketPath: string;
  extensionPath: string;
  invoke(request: HostedPiBrokerRequest, expectedBinding?: HostedPiBinding): Promise<HostedPiBrokerResponse>;
  close(): Promise<void>;
};

type ResolvedTarget = {
  path: string;
  exists: boolean;
  stat?: ReturnType<typeof statSync>;
};

type RootIdentity = {
  dev: number;
  ino: number;
  birthtimeMs: number;
};

function sameIdentity(left: RootIdentity, right: RootIdentity): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.birthtimeMs === right.birthtimeMs;
}

function identityOf(stat: Stats): RootIdentity {
  return { dev: stat.dev, ino: stat.ino, birthtimeMs: stat.birthtimeMs };
}

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/u;

function deny(code: string, message: string): HostedPiBrokerResponse {
  return { ok: false, code, message };
}

function validBindingValue(value: string, label: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || CONTROL_CHARS.test(value)) {
    throw new Error(`hosted Pi broker ${label} is invalid`);
  }
}

function comparable(input: string): string {
  const resolved = path.resolve(input);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(comparable(root), comparable(candidate));
  return relative === '' || (
    !path.isAbsolute(relative)
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
  );
}

function systemPath(input: string): boolean {
  const candidate = comparable(input);
  const roots = process.platform === 'win32'
    ? [
        process.env.SystemRoot,
        process.env.ProgramFiles,
        process.env['ProgramFiles(x86)'],
        process.env.ProgramData,
        process.env.CommonProgramFiles,
        process.env['CommonProgramFiles(x86)'],
        process.env.CommonProgramW6432,
      ]
    : ['/etc', '/proc', '/sys', '/dev', '/boot', '/usr', '/var', '/root', '/run'];
  return roots
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map(comparable)
    .some((root) => inside(root, candidate));
}

function safeProjectRoot(input: string): string {
  validBindingValue(input, 'project root');
  if (!path.isAbsolute(input)) throw new Error('hosted Pi broker project root must be absolute');
  let resolved: string;
  try {
    if (lstatSync(input).isSymbolicLink()) {
      throw new Error('project root must not be a symlink or junction');
    }
    resolved = realpathSync(input);
    if (comparable(resolved) !== comparable(path.resolve(input))) {
      throw new Error('project root must not resolve through a symlink or junction');
    }
    if (!statSync(resolved).isDirectory()) throw new Error('not a directory');
  } catch (error) {
    throw new Error(`hosted Pi broker project root is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (systemPath(resolved)) throw new Error('hosted Pi broker project root is a system path');
  return resolved;
}

function projectRootStillBound(root: string, expected?: RootIdentity): boolean {
  try {
    if (lstatSync(root).isSymbolicLink()) return false;
    const resolved = realpathSync(root);
    const current = statSync(resolved);
    return comparable(resolved) === comparable(root)
      && current.isDirectory()
      && (!expected || sameIdentity(identityOf(current), expected))
      && !systemPath(resolved);
  } catch {
    return false;
  }
}

function safeRuntimeRoot(input: string): string {
  if (!path.isAbsolute(input)) throw new Error('hosted Pi broker runtime root must be absolute');
  if (existsSync(input) && lstatSync(input).isSymbolicLink()) {
    throw new Error('hosted Pi broker runtime root must not be a symlink or junction');
  }
  mkdirSync(input, { recursive: true });
  const resolved = realpathSync(input);
  if (comparable(resolved) !== comparable(path.resolve(input))) {
    throw new Error('hosted Pi broker runtime root must not resolve through a symlink or junction');
  }
  if (systemPath(resolved)) throw new Error('hosted Pi broker runtime root is a system path');
  return resolved;
}

function sameSecret(expected: string, actual: unknown): boolean {
  if (typeof actual !== 'string') return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

function createToken(): string {
  return `odpi_${randomBytes(32).toString('base64url')}`;
}

function endpointFor(operation: HostedPiBrokerOperation): string {
  return operation === 'project:file:read'
    ? HOSTED_PI_BROKER_ENDPOINTS[1]
    : HOSTED_PI_BROKER_ENDPOINTS[0];
}

function validateOperation(value: string): value is HostedPiBrokerOperation {
  return (HOSTED_PI_BROKER_OPERATIONS as readonly string[]).includes(value);
}

function normalizeOperations(input: readonly HostedPiBrokerOperation[] | undefined): readonly HostedPiBrokerOperation[] {
  const operations = [...(input ?? HOSTED_PI_BROKER_OPERATIONS)];
  if (operations.length === 0 || operations.some((operation) => !validateOperation(operation))) {
    throw new Error('hosted Pi broker operation set is invalid');
  }
  return Object.freeze([...new Set(operations)]);
}

function normalizeEndpoints(input: readonly string[] | undefined): readonly string[] {
  const endpoints = [...(input ?? HOSTED_PI_BROKER_ENDPOINTS)];
  if (endpoints.length === 0 || endpoints.some((endpoint) => !HOSTED_PI_BROKER_ENDPOINTS.includes(endpoint as (typeof HOSTED_PI_BROKER_ENDPOINTS)[number]))) {
    throw new Error('hosted Pi broker endpoint set is invalid');
  }
  return Object.freeze([...new Set(endpoints)]);
}

function safeRelativePath(value: unknown, allowRoot: boolean): string | null {
  if (typeof value !== 'string' || value.length > 1024 || value.includes('\0')) return null;
  const normalized = value.replaceAll('\\', '/');
  if (!allowRoot && normalized.length === 0) return null;
  if (normalized.startsWith('/') || /^[A-Za-z]:/u.test(normalized)) return null;
  if (CONTROL_CHARS.test(normalized)) return null;
  const segments = normalized.split('/');
  if (segments.some((segment) => segment === '..' || segment === '.')) return null;
  // ponytail: root-level entries only until an openat/CreateFile-handle
  // implementation exists for nested paths on both POSIX and Windows.
  if (segments.length > 1) return null;
  return normalized;
}

function targetInsideProject(root: string, relative: string, allowMissing: boolean): ResolvedTarget | null {
  const candidate = path.resolve(root, ...relative.split('/'));
  if (!inside(root, candidate) || systemPath(candidate)) return null;

  if (existsSync(candidate)) {
    try {
      if (lstatSync(candidate).isSymbolicLink()) return null;
      const resolved = realpathSync(candidate);
      if (!inside(root, resolved) || systemPath(resolved)) return null;
      return { path: resolved, exists: true, stat: statSync(resolved) };
    } catch {
      return null;
    }
  }
  if (!allowMissing) return null;

  let parent = path.dirname(candidate);
  while (!existsSync(parent)) {
    const next = path.dirname(parent);
    if (next === parent) return null;
    parent = next;
  }
  try {
    if (lstatSync(parent).isSymbolicLink()) return null;
    const resolvedParent = realpathSync(parent);
    if (!inside(root, resolvedParent) || systemPath(resolvedParent)) return null;
    return { path: candidate, exists: false };
  } catch {
    return null;
  }
}

function bindingMatches(expected: HostedPiBinding, grant: HostedPiBrokerGrant): boolean {
  return expected.userKey === grant.userKey
    && expected.runId === grant.runId
    && expected.projectId === grant.projectId
    && comparable(expected.projectRoot) === comparable(grant.projectRoot);
}

function parseSocketMessage(line: string): HostedPiBrokerRequest | null {
  if (Buffer.byteLength(line, 'utf8') > MAX_REQUEST_BYTES) return null;
  try {
    const value = JSON.parse(line) as Partial<HostedPiBrokerRequest>;
    if (typeof value.token !== 'string' || typeof value.operation !== 'string') return null;
    return {
      token: value.token,
      operation: value.operation,
      ...(typeof value.path === 'string' ? { path: value.path } : {}),
      ...(typeof value.content === 'string' ? { content: value.content } : {}),
    };
  } catch {
    return null;
  }
}

function writeResponse(socket: Socket, response: HostedPiBrokerResponse): void {
  socket.write(`${JSON.stringify(response)}\n`);
}

function writeProjectFile(root: string, rootIdentity: RootIdentity, target: ResolvedTarget, content: string): void {
  if (!projectRootStillBound(root, rootIdentity)) throw new Error('project root escaped');
  const parent = path.dirname(target.path);
  const parentResolved = realpathSync(parent);
  if (!inside(root, parentResolved) || systemPath(parentResolved)) throw new Error('project parent escaped');
  if (lstatSync(parentResolved).isSymbolicLink() || comparable(realpathSync(parentResolved)) !== comparable(parentResolved)) {
    throw new Error('project parent became a link');
  }
  const destination = path.join(parentResolved, path.basename(target.path));
  const temporary = path.join(parentResolved, `.od-hosted-${randomBytes(12).toString('hex')}.tmp`);
  try {
    writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    if (!projectRootStillBound(root, rootIdentity)) throw new Error('project root escaped');
    if (existsSync(destination)) {
      if (lstatSync(destination).isSymbolicLink()) throw new Error('project target became a link');
      const resolved = realpathSync(destination);
      if (!inside(root, resolved) || systemPath(resolved)) throw new Error('project target escaped');
    }
    renameSync(temporary, destination);
    const resolved = realpathSync(destination);
    if (!inside(root, resolved) || systemPath(resolved)) throw new Error('project target escaped');
  } finally {
    rmSync(temporary, { force: true });
  }
}

function readProjectFile(root: string, rootIdentity: RootIdentity, target: ResolvedTarget): string {
  if (!projectRootStillBound(root, rootIdentity)) throw new Error('project root escaped');
  const file = openSync(
    target.path,
    process.platform === 'win32' ? 'r' : constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const opened = fstatSync(file);
    if (!opened.isFile() || opened.size > MAX_FILE_BYTES) throw new Error('project file is not a regular file');
    const openedIdentity = identityOf(opened);
    const currentBeforeRead = statSync(target.path);
    if (!sameIdentity(openedIdentity, identityOf(currentBeforeRead))) {
      throw new Error('project target changed during open');
    }
    const content = readFileSync(file, 'utf8');
    if (!projectRootStillBound(root, rootIdentity)) throw new Error('project root escaped');
    const current = lstatSync(target.path);
    const resolved = realpathSync(target.path);
    if (current.isSymbolicLink() || resolved !== target.path || !inside(root, resolved) || systemPath(resolved)
      || !sameIdentity(openedIdentity, identityOf(current))) {
      throw new Error('project target escaped');
    }
    return content;
  } finally {
    closeSync(file);
  }
}

function listProjectDirectory(root: string, rootIdentity: RootIdentity, target: ResolvedTarget): string[] {
  if (!projectRootStillBound(root, rootIdentity)) throw new Error('project root escaped');
  const directory = opendirSync(target.path);
  try {
    const entries = [] as Array<{ name: string; isSymbolicLink(): boolean }>;
    let entry = directory.readSync();
    while (entry) {
      entries.push(entry);
      entry = directory.readSync();
    }
    if (!projectRootStillBound(root, rootIdentity)) throw new Error('project root escaped');
    const resolved = realpathSync(target.path);
    if (resolved !== target.path || !inside(root, resolved) || systemPath(resolved)) {
      throw new Error('project directory escaped');
    }
    if (entries.some((item) => item.isSymbolicLink())) throw new Error('linked project entries are not allowed');
    return entries.map((item) => item.name).sort();
  } finally {
    directory.closeSync();
  }
}

async function listen(server: Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(socketPath);
  });
}

export async function createHostedPiBroker(options: {
  binding: HostedPiBinding;
  runtimeRoot: string;
}): Promise<HostedPiBroker> {
  const binding = options.binding;
  validBindingValue(binding.userKey, 'user key');
  validBindingValue(binding.runId, 'run id');
  validBindingValue(binding.projectId, 'project id');
  const projectRoot = safeProjectRoot(binding.projectRoot);
  const projectRootStat = statSync(projectRoot);
  const projectRootIdentity: RootIdentity = {
    dev: projectRootStat.dev,
    ino: projectRootStat.ino,
    birthtimeMs: projectRootStat.birthtimeMs,
  };
  const allowedOperations = normalizeOperations(binding.allowedOperations);
  const allowedEndpoints = normalizeEndpoints(binding.allowedEndpoints);
  const grant: HostedPiBrokerGrant = Object.freeze({
    token: createToken(),
    userKey: binding.userKey,
    runId: binding.runId,
    projectId: binding.projectId,
    projectRoot,
    allowedEndpoints,
    allowedOperations,
  });
  const runtimeRoot = safeRuntimeRoot(options.runtimeRoot);
  if (inside(projectRoot, runtimeRoot)) {
    throw new Error('hosted Pi broker runtime root must stay outside the project root');
  }
  const socketPath = process.platform === 'win32'
    ? `\\\\.\\pipe\\OpenDesign.HostedPi.${process.pid}.${randomBytes(12).toString('hex')}`
    : path.join(runtimeRoot, `hosted-pi-${randomBytes(12).toString('hex')}.sock`);
  if (process.platform !== 'win32' && existsSync(socketPath)) rmSync(socketPath, { force: true });

  let closed = false;
  let operationTail: Promise<void> = Promise.resolve();
  const invokeUnlocked = async (
    request: HostedPiBrokerRequest,
    expectedBinding?: HostedPiBinding,
  ): Promise<HostedPiBrokerResponse> => {
    if (closed) return deny('BROKER_CLOSED', 'hosted Pi broker is closed');
    if (!projectRootStillBound(grant.projectRoot, projectRootIdentity)) return deny('BROKER_PATH_DENIED', 'bound project root changed');
    if (!sameSecret(grant.token, request.token)) return deny('BROKER_TOKEN_INVALID', 'broker token is invalid');
    if (expectedBinding && !bindingMatches(expectedBinding, grant)) {
      return deny('BROKER_BINDING_MISMATCH', 'broker grant does not match the authenticated binding');
    }
    if (!validateOperation(request.operation)) return deny('BROKER_OPERATION_DENIED', 'broker operation is not allowed');
    const operation = request.operation;
    if (!grant.allowedOperations.includes(operation)) return deny('BROKER_OPERATION_DENIED', 'broker operation is not granted');
    const endpoint = endpointFor(operation);
    if (!grant.allowedEndpoints.includes(endpoint)) return deny('BROKER_ENDPOINT_DENIED', 'broker endpoint is not granted');

    const relative = safeRelativePath(request.path ?? '', operation === 'project:file:list');
    if (relative === null) return deny('BROKER_PATH_DENIED', 'project path must be relative and link-free');
    if (operation === 'project:file:list' && relative !== '') {
      return deny('BROKER_PATH_DENIED', 'project listing is restricted to the bound root');
    }
    const target = targetInsideProject(grant.projectRoot, relative, operation === 'project:file:write');
    if (!target) return deny('BROKER_PATH_DENIED', 'project path escapes the bound project root');
    // Re-resolve immediately before touching the filesystem. The operation
    // lock prevents broker-side races; these checks reject a concurrent
    // project/link swap before the path-based primitives below run.
    const currentTarget = targetInsideProject(grant.projectRoot, relative, operation === 'project:file:write');
    if (!currentTarget || comparable(currentTarget.path) !== comparable(target.path)) {
      return deny('BROKER_PATH_DENIED', 'project path changed during validation');
    }

    if (operation === 'project:file:list') {
      if (!target.exists || !target.stat?.isDirectory()) return deny('BROKER_PATH_DENIED', 'list target must be a directory');
      try {
        return { ok: true, operation, entries: listProjectDirectory(grant.projectRoot, projectRootIdentity, target) };
      } catch {
        return deny('BROKER_PATH_DENIED', 'linked project entries are not allowed');
      }
    }
    if (operation === 'project:file:read') {
      if (!target.exists || !target.stat?.isFile()) return deny('BROKER_PATH_DENIED', 'read target must be a regular file');
      if (target.stat.size > MAX_FILE_BYTES) return deny('BROKER_LIMIT', 'project file is too large');
      try {
        return { ok: true, operation, content: readProjectFile(grant.projectRoot, projectRootIdentity, target) };
      } catch {
        return deny('BROKER_READ_FAILED', 'project file could not be read');
      }
    }
    if (typeof request.content !== 'string' || Buffer.byteLength(request.content, 'utf8') > MAX_FILE_BYTES) {
      return deny('BROKER_LIMIT', 'project file content is too large');
    }
    if (target.exists && !target.stat?.isFile()) return deny('BROKER_PATH_DENIED', 'write target must be a regular file');
    try {
      writeProjectFile(grant.projectRoot, projectRootIdentity, target, request.content);
      return { ok: true, operation };
    } catch {
      return deny('BROKER_WRITE_FAILED', 'project file could not be written');
    }
  };

  // ponytail: serialize each broker's tiny file operation; per-project locks
  // can replace this if a future workload needs concurrent file throughput.
  const invoke = async (
    request: HostedPiBrokerRequest,
    expectedBinding?: HostedPiBinding,
  ): Promise<HostedPiBrokerResponse> => {
    const previous = operationTail;
    let release!: () => void;
    operationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await invokeUnlocked(request, expectedBinding);
    } finally {
      release();
    }
  };

  const server = createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('error', () => socket.destroy());
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, 'utf8') > MAX_REQUEST_BYTES) {
        writeResponse(socket, deny('BROKER_REQUEST_TOO_LARGE', 'broker request is too large'));
        socket.destroy();
        return;
      }
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const request = parseSocketMessage(line);
        void invoke(request ?? { token: '', operation: '' }).then((response) => writeResponse(socket, response));
        newline = buffer.indexOf('\n');
      }
    });
  });

  await listen(server, socketPath);
  if (process.platform !== 'win32') chmodSync(socketPath, 0o600);

  return {
    grant,
    token: grant.token,
    socketPath,
    extensionPath: hostedPiBrokerExtensionPath(),
    invoke,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (process.platform !== 'win32') {
        try { unlinkSync(socketPath); } catch { /* already removed */ }
      }
    },
  };
}
