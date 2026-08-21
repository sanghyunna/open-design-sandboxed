import { spawn } from 'node:child_process';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';

export const scriptRoot = dirname(fileURLToPath(import.meta.url));
export const workspaceRoot = dirname(dirname(scriptRoot));
export const canonicalProductName = 'Readable Studio';
export const previewSelector = '[data-testid="artifact-preview-frame"]:visible, [data-testid="artifact-preview-frame-url-load"]:visible, [data-testid="artifact-preview-frame-srcdoc"]:visible';

export type QaCase = 'full' | 'bad-root';

export type Options = {
  readonly case: QaCase;
  readonly evidenceRoot: string;
  readonly offline: boolean;
  readonly zipPath: string;
};

export type CommandResult = {
  readonly args: readonly string[];
  readonly command: string;
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
};

export class PortableQaError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PortableQaError';
  }
}

export function parseOptions(argv: readonly string[]): Options {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write('Usage: tsx scripts/portable-qa.ts --zip <portable.zip> --case full|bad-root --evidence <dir> [--offline]\n');
    process.exit(0);
  }
  const values = new Map<string, string>();
  let offline = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--offline') {
      offline = true;
      continue;
    }
    if (token !== '--zip' && token !== '--case' && token !== '--evidence') {
      throw new PortableQaError(`unknown argument: ${token ?? '<missing>'}`);
    }
    const value = argv[index + 1];
    if (value == null || value.startsWith('--')) throw new PortableQaError(`missing value for ${token}`);
    values.set(token, value);
    index += 1;
  }
  const zipValue = values.get('--zip');
  const caseValue = values.get('--case');
  const evidenceValue = values.get('--evidence');
  if (zipValue == null || caseValue == null || evidenceValue == null) {
    throw new PortableQaError('--zip, --case, and --evidence are required');
  }
  return {
    case: parseCase(caseValue),
    evidenceRoot: resolveFromWorkspace(evidenceValue),
    offline,
    zipPath: resolveFromWorkspace(zipValue),
  };
}

function parseCase(value: string): QaCase {
  switch (value) {
    case 'full':
    case 'bad-root':
      return value;
    default:
      throw new PortableQaError(`invalid --case: ${value}`);
  }
}

function resolveFromWorkspace(path: string): string {
  return isAbsolute(path) ? path : resolve(workspaceRoot, path);
}

export async function runCommand(command: string, args: readonly string[], input?: string): Promise<CommandResult> {
  const child = spawn(command, args, {
    cwd: workspaceRoot,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  if (input == null) child.stdin.end();
  else child.stdin.end(input, 'utf8');
  const exitCode = await new Promise<number>((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', (code) => resolveExit(code ?? 1));
  });
  return {
    args,
    command,
    exitCode,
    stderr: Buffer.concat(stderr).toString('utf8'),
    stdout: Buffer.concat(stdout).toString('utf8'),
  };
}

export function toRecord(value: unknown, label = 'value'): Record<string, unknown> {
  if (typeof value !== 'object' || value == null || Array.isArray(value)) {
    throw new PortableQaError(`${label} must be a JSON object`);
  }
  return Object.fromEntries(Object.entries(value));
}

export async function writeEvidence(root: string, name: string, value: unknown): Promise<void> {
  await writeFile(resolve(root, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
