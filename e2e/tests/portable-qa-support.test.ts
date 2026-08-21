import assert from 'node:assert/strict';
import test from 'node:test';

import { PortableQaError, validateEvidenceRoot, workspaceRoot } from '../scripts/portable-qa-support.ts';

test('portable QA refuses the repository root as an evidence root', () => {
  assert.throws(
    () => validateEvidenceRoot(workspaceRoot),
    (error: unknown) => error instanceof PortableQaError && /dedicated evidence directory/.test(error.message),
  );
});
