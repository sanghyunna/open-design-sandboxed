import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const boundary = process.argv[2];
if (boundary == null || !/^pr\d{2}$/u.test(boundary)) {
  throw new Error('usage: hosted-validation.ts <prNN>');
}

const manifest = JSON.parse(
  readFileSync(new URL('../../../.github/hosted-validation.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const commands = manifest[boundary];
if (!Array.isArray(commands) || commands.length === 0 || !commands.every((value) => typeof value === 'string')) {
  throw new Error(`hosted validation boundary is missing: ${boundary}`);
}

for (const command of commands) {
  const result = spawnSync(command, { shell: true, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
