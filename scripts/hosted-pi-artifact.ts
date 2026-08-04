import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(import.meta.dirname, '..');
const hostedPiPackageName = '@earendil-works/pi-coding-agent';
const hostedPiVersion = '0.83.0';
const hostedPiIntegrity = 'sha512-uYhF+FsZxogoSX/AxBcUdiY+ZklubwaXyAoEGA2eQwsHcyEAhUYIKh/WLXe/a8+k8eTCmxb+ZN2Zo9mzQtzbWw==';
const photonVersion = '0.3.4';
const defaultOutput = path.join(repoRoot, '.tmp', 'hosted-pi-artifact');

type JsonObject = Record<string, unknown>;

function fail(message: string): never {
  throw new Error(`[hosted-pi-artifact] ${message}`);
}

function readJson(file: string): JsonObject {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as JsonObject;
  } catch (error) {
    fail(`cannot read JSON ${path.relative(repoRoot, file)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function packageRoot(stage: string): string {
  const root = path.join(stage, 'node_modules', '@earendil-works', 'pi-coding-agent');
  if (!existsSync(root)) fail(`staged Pi package is missing: ${root}`);
  return realpathSync(root);
}

function verifyPackage(stage: string): {
  piRoot: string;
  piManifest: JsonObject;
  photonRoot: string;
  photonManifest: JsonObject;
  photonWasm: string;
} {
  const piRoot = packageRoot(stage);
  const piManifest = readJson(path.join(piRoot, 'package.json'));
  if (piManifest.name !== hostedPiPackageName || piManifest.version !== hostedPiVersion) {
    fail(`staged Pi package is not ${hostedPiPackageName}@${hostedPiVersion}`);
  }
  const entrypoint = path.join(piRoot, 'dist', 'rpc-entry.js');
  if (!lstatSync(entrypoint).isFile()) fail('staged Pi RPC entrypoint is missing');

  const lockfile = path.join(stage, 'node_modules', '.pnpm', 'lock.yaml');
  if (!existsSync(lockfile)) fail('staged production lockfile is missing');
  const lockText = readFileSync(lockfile, 'utf8');
  if (!lockText.includes(`${hostedPiPackageName}@${hostedPiVersion}`)) {
    fail('staged lockfile does not contain the pinned Pi package');
  }
  if (!lockText.includes(hostedPiIntegrity)) fail('staged lockfile lost the pinned Pi integrity');

  let photonRoot: string;
  try {
    const requireFromPi = createRequire(path.join(piRoot, 'package.json'));
    photonRoot = path.dirname(requireFromPi.resolve('@silvia-odwyer/photon-node'));
  } catch {
    fail('Photon dependency is missing from the staged Pi package');
  }
  const photonManifest = readJson(path.join(photonRoot, 'package.json'));
  if (photonManifest.version !== photonVersion) fail(`Photon version must be ${photonVersion}`);
  const photonWasm = path.join(photonRoot, 'photon_rs_bg.wasm');
  if (!lstatSync(photonWasm).isFile()) fail('Photon WASM asset is missing');
  if (!existsSync(path.join(photonRoot, 'LICENSE.md'))) fail('Photon license file is missing');
  if (existsSync(path.join(stage, 'node_modules', '@mariozechner', 'clipboard'))) {
    fail('optional clipboard package must not be required by the hosted artifact');
  }

  return { piRoot, piManifest, photonRoot: realpathSync(photonRoot), photonManifest, photonWasm };
}

function collectDependencies(stage: string): Array<Record<string, unknown>> {
  const store = path.join(stage, 'node_modules', '.pnpm');
  const entries = new Map<string, Record<string, unknown>>();
  for (const packageStore of readdirSync(store, { withFileTypes: true })) {
    if (!packageStore.isDirectory() || packageStore.name === '.bin') continue;
    const modules = path.join(store, packageStore.name, 'node_modules');
    if (!existsSync(modules)) continue;
    for (const scopeOrPackage of readdirSync(modules, { withFileTypes: true })) {
      const candidates = scopeOrPackage.name.startsWith('@')
        ? readdirSync(path.join(modules, scopeOrPackage.name), { withFileTypes: true }).map((child) => path.join(scopeOrPackage.name, child.name))
        : [scopeOrPackage.name];
      for (const relative of candidates) {
        const manifestPath = path.join(modules, relative, 'package.json');
        if (!existsSync(manifestPath)) continue;
        const manifest = readJson(manifestPath);
        if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') continue;
        const key = `${manifest.name}@${manifest.version}`;
        if (entries.has(key)) continue;
        entries.set(key, {
          name: manifest.name,
          version: manifest.version,
          license: manifest.license ?? null,
          repository: manifest.repository ?? null,
        });
      }
    }
  }
  return [...entries.values()].sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`));
}

function verifyArtifact(stage: string, writeManifest: boolean): void {
  if (!existsSync(stage)) fail(`artifact does not exist: ${stage}`);
  const { piRoot, piManifest, photonManifest, photonWasm } = verifyPackage(stage);
  const manifest = {
    schemaVersion: 1,
    builtOn: { platform: process.platform, arch: process.arch, node: process.version },
    packageManager: 'pnpm deploy --prod --no-optional --ignore-scripts --legacy',
    pi: {
      name: hostedPiPackageName,
      version: hostedPiVersion,
      integrity: hostedPiIntegrity,
      license: piManifest.license ?? null,
      entrypoint: path.relative(stage, path.join(piRoot, 'dist', 'rpc-entry.js')),
    },
    photon: {
      name: '@silvia-odwyer/photon-node',
      version: photonVersion,
      license: photonManifest.license ?? null,
      wasm: path.relative(stage, photonWasm),
      wasmSha256: sha256(photonWasm),
    },
    dependencies: collectDependencies(stage),
    lockfileSha256: sha256(path.join(stage, 'node_modules', '.pnpm', 'lock.yaml')),
  };
  if (writeManifest) writeFileSync(path.join(stage, 'hosted-pi-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  else {
    const recorded = readJson(path.join(stage, 'hosted-pi-manifest.json'));
    const recordedPi = recorded.pi as JsonObject | undefined;
    const recordedPhoton = recorded.photon as JsonObject | undefined;
    if (recordedPi?.integrity !== hostedPiIntegrity || recordedPi.version !== hostedPiVersion) {
      fail('hosted manifest does not match the pinned Pi package');
    }
    if (recordedPhoton?.version !== photonVersion || recordedPhoton.wasmSha256 !== manifest.photon.wasmSha256) {
      fail('hosted manifest does not match the staged Photon WASM');
    }
    if (!Array.isArray(recorded.dependencies) || recorded.dependencies.length === 0) {
      fail('hosted manifest is missing the dependency inventory');
    }
    if (recorded.lockfileSha256 !== manifest.lockfileSha256) fail('hosted manifest lockfile hash does not match the staged lockfile');
  }
}

function packageManagerCommand(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function runBuildCommand(args: string[]): void {
  const result = spawnSync(packageManagerCommand(), args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) fail(`failed to run pnpm: ${result.error.message}`);
  if (result.status !== 0) fail(`pnpm ${args.join(' ')} exited with ${result.status ?? 'signal'}`);
}

function auditHostedProductionGraph(): void {
  const result = spawnSync(packageManagerCommand(), ['audit', '--prod', '--audit-level', 'high', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.error) fail(`failed to run the production dependency audit: ${result.error.message}`);
  let report: JsonObject;
  try {
    report = JSON.parse(result.stdout) as JsonObject;
  } catch (error) {
    fail(`production dependency audit did not return JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const advisories = report.advisories as Record<string, JsonObject> | undefined;
  const violations: string[] = [];
  for (const advisory of Object.values(advisories ?? {})) {
    const severity = advisory.severity;
    if (severity !== 'high' && severity !== 'critical') continue;
    for (const finding of (advisory.findings as JsonObject[] | undefined) ?? []) {
      const paths = (finding.paths as string[] | undefined) ?? [];
      if (paths.some((dependencyPath) => dependencyPath.startsWith('apps__daemon>'))) {
        violations.push(`${String(advisory.module_name)}@${String(finding.version)} (${String(severity)})`);
      }
    }
  }
  if (violations.length > 0) {
    fail(`hosted production dependency graph has high/critical advisories: ${[...new Set(violations)].join(', ')}`);
  }
}

function parseOutput(): string {
  const index = process.argv.indexOf('--out');
  const raw = index >= 0 ? process.argv[index + 1] : undefined;
  return path.resolve(repoRoot, raw ?? defaultOutput);
}

function build(stage: string): void {
  const tmpRoot = path.join(repoRoot, '.tmp');
  const relative = path.relative(tmpRoot, stage);
  if (stage === repoRoot || path.isAbsolute(relative) || relative.startsWith(`..${path.sep}`) || existsSync(stage)) {
    fail(`refusing to overwrite output outside a fresh .tmp directory: ${stage}`);
  }
  mkdirSync(path.dirname(stage), { recursive: true });
  runBuildCommand(['--filter', '@open-design/daemon', 'build']);
  runBuildCommand(['--filter', '@open-design/daemon', 'deploy', '--prod', '--no-optional', '--ignore-scripts', '--legacy', stage]);
  verifyArtifact(stage, true);
  auditHostedProductionGraph();
  process.stdout.write(`Hosted Pi artifact staged at ${stage}\n`);
}

type Child = ReturnType<typeof spawn>;

function send(child: Child, value: JsonObject): void {
  child.stdin?.write(`${JSON.stringify(value)}\n`);
}

async function runRpcSmoke(stage: string): Promise<void> {
  const runtimeDir = path.join(stage, 'dist', 'runtimes');
  const fixturePath = path.join(runtimeDir, 'hosted-pi-fixture-provider.ts');
  copyFileSync(path.join(repoRoot, 'apps', 'daemon', 'tests', 'fixtures', 'hosted-pi-fixture-provider.ts'), fixturePath);
  const runtime = await import(pathToFileURL(path.join(runtimeDir, 'hosted-pi-runtime.js')).href);
  const brokerModule = await import(pathToFileURL(path.join(runtimeDir, 'hosted-pi-broker.js')).href);
  const smokeRoot = path.join(os.tmpdir(), `od-hosted-pi-smoke-${process.pid}-${Date.now()}`);
  const project = path.join(smokeRoot, 'project');
  const runtimeRoot = path.join(smokeRoot, 'runtime');
  const sessionDir = path.join(smokeRoot, 'sessions');
  mkdirSync(project, { recursive: true });
  mkdirSync(runtimeRoot, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(path.join(project, 'fixture.txt'), 'fixture');
  const broker = await brokerModule.createHostedPiBroker({
    runtimeRoot,
    binding: { userKey: 'artifact-user', runId: 'artifact-run', projectId: 'artifact-project', projectRoot: project },
  });
  const invocation = runtime.createHostedPiInvocation({
    packageRoot: path.join(stage, 'node_modules', '@earendil-works', 'pi-coding-agent'),
    cwd: project,
    sessionDir,
    model: 'hosted-fixture/fixture-model',
    broker,
  });
  invocation.args.push('--extension', fixturePath);
  const child = spawn(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    env: invocation.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines: JsonObject[] = [];
  let pending = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    pending += chunk;
    let newline = pending.indexOf('\n');
    while (newline >= 0) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (line) {
        try { lines.push(JSON.parse(line) as JsonObject); } catch { /* stderr carries diagnostics */ }
      }
      newline = pending.indexOf('\n');
    }
  });
  child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
  let cursor = 0;
  const waitForLine = (predicate: (line: JsonObject) => boolean): Promise<JsonObject> => new Promise((resolve, reject) => {
    let check: () => void;
    const timeout = setTimeout(() => {
      child.stdout?.off('data', check);
      reject(new Error('timed out waiting for hosted Pi RPC line'));
    }, 20_000);
    check = (): void => {
      for (; cursor < lines.length; cursor++) {
        const line = lines[cursor];
        if (line && predicate(line)) {
          cursor += 1;
          clearTimeout(timeout);
          child.stdout?.off('data', check);
          resolve(line);
          return;
        }
      }
    };
    child.stdout?.on('data', check);
    check();
  });
  try {
    const brokerWrite = await broker.invoke({
      token: broker.grant.token,
      operation: 'project:file:write',
      path: 'broker-fixture.txt',
      content: 'broker fixture',
    });
    if (!brokerWrite.ok) fail(`staged broker write failed: ${brokerWrite.message}`);
    const brokerRead = await broker.invoke({
      token: broker.grant.token,
      operation: 'project:file:read',
      path: 'broker-fixture.txt',
    });
    if (!brokerRead.ok || brokerRead.content !== 'broker fixture') fail('staged broker read failed');
    const brokerList = await broker.invoke({
      token: broker.grant.token,
      operation: 'project:file:list',
      path: '',
    });
    if (!brokerList.ok || !brokerList.entries?.includes('fixture.txt')) fail('staged broker list failed');
    if (invocation.command !== process.execPath || invocation.env.PATH !== '') fail('smoke did not use the package-local Node invocation boundary');
    for (const command of ['pi', 'npm', 'pnpm', 'npx']) {
      const unavailable = spawnSync(command, ['--version'], {
        cwd: project,
        env: invocation.env,
        shell: false,
        stdio: 'ignore',
      });
      if (unavailable.status !== null) fail(`package manager or global Pi command resolved despite an empty PATH: ${command}`);
    }
    send(child, { id: 1, type: 'get_state' });
    const state = await waitForLine((line) => line.type === 'response' && line.id === 1);
    if (state.success !== true || !(state.data as JsonObject | undefined)?.sessionFile) fail('get_state did not return a session reference');
    const sessionFile = (state.data as JsonObject).sessionFile as string;

    send(child, { id: 2, type: 'prompt', message: 'deterministic fixture turn' });
    await waitForLine((line) => line.type === 'agent_end');
    if (!lines.some((line) => line.type === 'turn_end' && (line.message as JsonObject | undefined)?.usage)) {
      fail('fixture turn did not emit usage');
    }

    send(child, { id: 3, type: 'new_session', parentSession: sessionFile });
    const resumed = await waitForLine((line) => line.type === 'response' && line.id === 3);
    if (resumed.success !== true) fail('parent-session resume was rejected');
    send(child, { id: 4, type: 'prompt', message: 'resumed fixture turn' });
    await waitForLine((line) => line.type === 'agent_end');

    send(child, { id: 5, type: 'prompt', message: 'cancel fixture turn' });
    await waitForLine((line) => line.type === 'turn_start');
    send(child, { id: 6, type: 'abort' });
    await waitForLine((line) => line.type === 'agent_end');
    const abortedTurn = lines.find((line) => line.type === 'turn_end'
      && ((line.message as JsonObject | undefined)?.stopReason === 'aborted'));
    if (!abortedTurn) fail('RPC cancellation did not produce an aborted turn');

    send(child, { id: 7, type: 'set_model', provider: 'missing', modelId: 'missing' });
    const error = await waitForLine((line) => line.type === 'response' && line.id === 7);
    if (error.success !== false) fail('invalid model error path unexpectedly succeeded');
  } catch (error) {
    const detail = stderr.trim();
    const observed = lines.map((line) => String(line.type)).join(', ');
    const details = lines.filter((line) => line.type === 'turn_end' || line.type === 'response').map((line) => JSON.stringify(line)).join('\n');
    fail(`${error instanceof Error ? error.message : String(error)}\nObserved RPC lines: ${observed}\nRPC details:\n${details}${detail ? `\nPi stderr:\n${detail}` : ''}`);
  } finally {
    child.stdin?.end();
    if (!child.killed) child.kill();
    if (child.exitCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2_000);
        child.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    await broker.close();
    rmSync(fixturePath, { force: true });
    rmSync(smokeRoot, { recursive: true, force: true });
  }
}

async function check(stage: string): Promise<void> {
  verifyArtifact(stage, false);
  auditHostedProductionGraph();
  await runRpcSmoke(stage);
  process.stdout.write(`Hosted Pi artifact check passed for ${process.platform}/${process.arch}\n`);
}

const command = process.argv[2] ?? 'build';
const output = parseOutput();
if (command === 'build') build(output);
else if (command === 'check') await check(output);
else fail(`unknown command ${command}; use build or check`);
