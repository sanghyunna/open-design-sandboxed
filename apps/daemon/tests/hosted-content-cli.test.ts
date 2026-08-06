import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const daemonRoot = fileURLToPath(new URL('..', import.meta.url));
const cliEntry = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const projectId = 'project-1';
const artifactId = `oda_${'A'.repeat(43)}`;

type RequestRecord = {
  body: Buffer;
  headers: http.IncomingHttpHeaders;
  method: string;
  url: string;
};

const requests: RequestRecord[] = [];
let baseOrigin = '';
let csrfSequence = 0;
let retryWrite = true;
let server: http.Server;
let tempRoot: string;
let identityFile: string;

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'od-hosted-content-cli-'));
  identityFile = path.join(tempRoot, 'identity.txt');
  await writeFile(identityFile, 'identity-secret\n');
  server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const record: RequestRecord = {
      body: Buffer.concat(chunks),
      headers: request.headers,
      method: request.method ?? 'GET',
      url: request.url ?? '/',
    };
    requests.push(record);

    if (record.url === '/api/hosted/session') {
      csrfSequence += 1;
      return json(response, {
        publicOrigin: baseOrigin,
        csrfToken: `csrf-${csrfSequence}`,
        csrfExpiresAt: Date.now() + 60_000,
        providers: [],
      });
    }
    if (record.url === `/api/projects/${projectId}/files?since=0`) {
      return json(response, { files: [{ name: 'src/a.txt', size: 1 }] });
    }
    if (record.url === `/api/projects/${projectId}/files?since=999`) {
      response.writeHead(307, { location: 'https://attacker.example/files' }).end();
      return;
    }
    if (record.url === `/api/projects/${projectId}/files/src/a.txt` && record.method === 'GET') {
      response.writeHead(200, { 'content-type': 'text/plain' }).end('A');
      return;
    }
    if (record.url === `/api/projects/${projectId}/files` && record.method === 'POST') {
      const body = JSON.parse(record.body.toString('utf8')) as { name: string };
      if (body.name === 'retry.txt' && retryWrite) {
        retryWrite = false;
        return json(response, { error: { code: 'HOSTED_CSRF_INVALID' } }, 419);
      }
      return json(response, { file: { name: body.name } });
    }
    if (record.url === `/api/projects/${projectId}/files/rename`) {
      return json(response, { ok: true });
    }
    if (record.url === `/api/projects/${projectId}/files/src/old.txt` && record.method === 'DELETE') {
      return json(response, { ok: true });
    }
    if (record.url.startsWith(`/api/projects/${projectId}/search?`)) {
      return json(response, { matches: [{ file: 'src/a.txt', line: 1, snippet: 'hello' }] });
    }
    if (record.url === `/api/projects/${projectId}/folders`) {
      return json(response, record.method === 'GET' ? { folders: [{ path: 'src' }] } : { ok: true });
    }
    if (record.url === `/api/projects/${projectId}/upload`) {
      return json(response, { files: [{ name: 'assets/upload.txt' }] });
    }
    if (record.url === `/api/projects/${projectId}/files/preview`) {
      return json(response, { url: `/api/projects/${projectId}/preview/scope/src/a.txt` });
    }
    if (record.url === `/api/projects/${projectId}/preview-url`) {
      return json(response, { url: `/api/projects/${projectId}/preview/scope/src/a.txt` });
    }
    if (record.url === `/api/projects/${projectId}/archive?root=src`) {
      response.writeHead(200, { 'content-type': 'application/zip' }).end('ZIP');
      return;
    }
    if (record.url === `/api/projects/${projectId}/export/manifest`) {
      return json(response, { projectId, files: [] });
    }
    if (record.url === '/api/artifacts/save') {
      return json(response, { artifactId, url: `/api/artifacts/${artifactId}/download`, lint: [] });
    }
    if (record.url === '/api/artifacts/lint') {
      return json(response, { findings: [], agentMessage: 'clean' });
    }
    if (record.url === `/api/artifacts/${artifactId}/download`) {
      response.writeHead(200, { 'content-type': 'text/html' }).end('<h1>saved</h1>');
      return;
    }
    json(response, { error: { code: 'NOT_FOUND', message: record.url } }, 404);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address == null || typeof address === 'string') throw new Error('test server did not bind');
  baseOrigin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(tempRoot, { recursive: true, force: true });
});

describe('hosted PR08 content CLI', () => {
  it('uses the frozen file, search, folder, and canonical wildcard routes', async () => {
    expect((await runCli(['files', 'list', projectId, '--since', '0', '--json'])).stdout)
      .toContain('src/a.txt');
    expect((await runCli(['files', 'read', projectId, 'src/a.txt'])).stdout).toBe('A');
    await runCli(['files', 'write', projectId, 'src/new.txt', '--json'], 'hello');
    await runCli(['files', 'rename', projectId, 'src/new.txt', 'src/renamed.txt', '--json']);
    await runCli(['files', 'delete', projectId, 'src/old.txt', '--json']);
    await runCli(['files', 'search', projectId, '--query', 'hello', '--pattern', '*.txt', '--max', '10', '--json']);
    await runCli(['files', 'folders', 'list', projectId, '--json']);
    await runCli(['files', 'folders', 'create', projectId, 'assets/images', '--json']);
    await runCli(['files', 'folders', 'delete', projectId, 'assets/images', '--json']);

    const content = contentRequests();
    expect(content.map(({ method, url }) => [method, url])).toEqual([
      ['GET', `/api/projects/${projectId}/files?since=0`],
      ['GET', `/api/projects/${projectId}/files/src/a.txt`],
      ['POST', `/api/projects/${projectId}/files`],
      ['POST', `/api/projects/${projectId}/files/rename`],
      ['DELETE', `/api/projects/${projectId}/files/src/old.txt`],
      ['GET', `/api/projects/${projectId}/search?q=hello&pattern=*.txt&max=10`],
      ['GET', `/api/projects/${projectId}/folders`],
      ['POST', `/api/projects/${projectId}/folders`],
      ['DELETE', `/api/projects/${projectId}/folders`],
    ]);
    expect(JSON.parse(content[2]!.body.toString('utf8'))).toEqual({
      name: 'src/new.txt', content: 'hello', encoding: 'utf8',
    });
    expect(JSON.parse(content[3]!.body.toString('utf8'))).toEqual({
      from: 'src/new.txt', to: 'src/renamed.txt',
    });
    expect(JSON.parse(content[7]!.body.toString('utf8'))).toEqual({ path: 'assets/images' });
    expect(JSON.parse(content[8]!.body.toString('utf8'))).toEqual({ path: 'assets/images' });
    expectAuthorized(content);
  }, 30_000);

  it('uses multipart upload, POST preview DTOs, archive, and export manifest routes', async () => {
    requests.length = 0;
    const upload = path.join(tempRoot, 'upload.txt');
    await writeFile(upload, 'upload-body');
    await runCli(['files', 'upload', projectId, upload, '--as', 'assets/upload.txt', '--json']);
    await runCli(['files', 'preview', projectId, 'src/a.txt', '--json']);
    await runCli(['files', 'preview-url', projectId, 'src/a.txt', '--json']);
    expect((await runCli(['files', 'archive', projectId, '--root', 'src'])).stdout).toBe('ZIP');
    expect((await runCli(['files', 'export-manifest', projectId, '--json'])).stdout)
      .toContain(projectId);

    const content = contentRequests();
    expect(content.map(({ method, url }) => [method, url])).toEqual([
      ['POST', `/api/projects/${projectId}/upload`],
      ['POST', `/api/projects/${projectId}/files/preview`],
      ['POST', `/api/projects/${projectId}/preview-url`],
      ['GET', `/api/projects/${projectId}/archive?root=src`],
      ['GET', `/api/projects/${projectId}/export/manifest`],
    ]);
    expect(content[0]!.headers['content-type']).toContain('multipart/form-data; boundary=');
    expect(content[0]!.body.toString('utf8')).toContain('name="dir"\r\n\r\nassets');
    expect(content[0]!.body.toString('utf8')).toContain('filename="upload.txt"');
    expect(JSON.parse(content[1]!.body.toString('utf8'))).toEqual({ path: 'src/a.txt' });
    expect(JSON.parse(content[2]!.body.toString('utf8'))).toEqual({ file: 'src/a.txt' });
    expectAuthorized(content);
  }, 30_000);

  it('exposes hosted artifact save, lint, and opaque download without raw routes', async () => {
    requests.length = 0;
    const html = path.join(tempRoot, 'artifact.html');
    await writeFile(html, '<h1>saved</h1>');
    const saved = await runCli([
      'artifacts', 'save', '--html-file', html, '--identifier', 'hero', '--title', 'Hero', '--json',
    ]);
    expect(JSON.parse(saved.stdout)).toMatchObject({ artifactId });
    expect((await runCli(['artifacts', 'lint', '--html-file', html, '--json'])).stdout)
      .toContain('findings');
    expect((await runCli(
      ['artifacts', 'download', artifactId],
      undefined,
      true,
      false,
      { OD_HOSTED_IDENTITY_TOKEN_FILE: identityFile },
    )).stdout).toBe('<h1>saved</h1>');

    const content = contentRequests();
    expect(content.map(({ method, url }) => [method, url])).toEqual([
      ['POST', '/api/artifacts/save'],
      ['POST', '/api/artifacts/lint'],
      ['GET', `/api/artifacts/${artifactId}/download`],
    ]);
    expect(JSON.parse(content[0]!.body.toString('utf8'))).toEqual({
      html: '<h1>saved</h1>', identifier: 'hero', title: 'Hero',
    });
    expect(content.every(({ url }) => !url.includes('/raw/'))).toBe(true);
    expectAuthorized(content);
  }, 30_000);

  it('retries one 419 with an identical body and rejects traversal or competing stdin', async () => {
    requests.length = 0;
    retryWrite = true;
    await runCli(['files', 'write', projectId, 'retry.txt', '--json'], 'same-body');
    const writes = contentRequests().filter(({ url }) => url.endsWith('/files'));
    expect(writes).toHaveLength(2);
    expect(writes[0]!.body).toEqual(writes[1]!.body);
    expect(writes[0]!.headers['x-open-design-csrf']).not.toBe(writes[1]!.headers['x-open-design-csrf']);

    requests.length = 0;
    const traversal = await runCli(
      ['files', 'delete', projectId, '../secret.txt', '--json'],
      undefined,
      false,
    );
    expect(traversal.code).toBe(2);
    expect(traversal.stderr).toContain('canonical relative path');
    expect(contentRequests()).toEqual([]);

    const redirected = await runCli(
      ['files', 'list', projectId, '--since', '999', '--json'],
      undefined,
      false,
    );
    expect(redirected.code).toBe(1);
    expect(redirected.stderr).toContain('cross-origin redirect');
    expect(`${redirected.stdout}${redirected.stderr}`).not.toContain('identity-secret');

    const conflict = await runCli(
      ['files', 'write', projectId, 'safe.txt', '--identity-token-file', '-'],
      'identity-secret\ncontent',
      false,
      false,
    );
    expect(conflict.code).toBe(2);
    expect(conflict.stderr).toContain('stdin cannot supply both');
    expect(`${conflict.stdout}${conflict.stderr}`).not.toContain('identity-secret');
  }, 30_000);

  it('preserves the existing local JSON upload route when hosted identity is absent', async () => {
    requests.length = 0;
    const upload = path.join(tempRoot, 'local-upload.txt');
    await writeFile(upload, 'local');
    await runCli(
      ['files', 'upload', projectId, upload, '--as', 'local-upload.txt', '--json'],
      undefined,
      true,
      false,
    );
    const [request] = contentRequests();
    expect(request).toMatchObject({ method: 'POST', url: `/api/projects/${projectId}/files` });
    expect(request!.headers.authorization).toBeUndefined();
    expect(JSON.parse(request!.body.toString('utf8'))).toEqual({
      name: 'local-upload.txt',
      content: Buffer.from('local').toString('base64'),
      encoding: 'base64',
    });
  });
});

function json(response: http.ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

function contentRequests(): RequestRecord[] {
  return requests.filter(({ url }) => url !== '/api/hosted/session');
}

function expectAuthorized(records: RequestRecord[]): void {
  for (const record of records) {
    expect(record.headers.authorization).toBe('Bearer identity-secret');
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(record.method)) {
      expect(record.headers.origin).toBe(baseOrigin);
      expect(record.headers['x-open-design-csrf']).toMatch(/^csrf-/u);
    }
  }
}

async function runCli(
  args: string[],
  input?: string,
  expectSuccess = true,
  addIdentity = true,
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number; stderr: string; stdout: string }> {
  const fullArgs = [
    '--import', 'tsx', cliEntry, ...args,
    '--daemon-url', baseOrigin,
    ...(addIdentity ? ['--identity-token-file', identityFile] : []),
  ];
  const result = await new Promise<{ code: number; stderr: string; stdout: string }>((resolve, reject) => {
    const child = spawn(process.execPath, fullArgs, {
      cwd: daemonRoot,
      env: { ...process.env, OD_HOSTED_IDENTITY_TOKEN_FILE: '', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: code ?? -1, stderr, stdout }));
    child.stdin.end(input);
  });
  if (expectSuccess && result.code !== 0) {
    throw new Error(`CLI failed (${result.code}): ${result.stderr}`);
  }
  return result;
}
