import { describe, expect, it } from 'vitest';

import {
  extractOrbitAgentFinalExplanation,
} from '../src/orbit-agent-summary.js';

describe('Orbit agent summary helpers', () => {
  it('extracts only user-visible text deltas from run events', () => {
    expect(
      extractOrbitAgentFinalExplanation([
        { event: 'stdout', data: { chunk: 'raw tool output' } },
        { event: 'stderr', data: { chunk: 'OPENAI_API_KEY=sk-raw-secret' } },
        { event: 'tool_result', data: { output: 'token=raw-tool-secret' } },
        { event: 'agent', data: { type: 'thinking_delta', delta: 'private reasoning' } },
        { event: 'agent', data: { type: 'tool_use', name: 'Read' } },
        { event: 'agent', data: { type: 'text_delta', delta: 'GitHub auth failed.' } },
      ]),
    ).toBe('GitHub auth failed.');
  });

  it('bounds long final explanations before storing them in the Orbit receipt', () => {
    const explanation = extractOrbitAgentFinalExplanation([
      { event: 'agent', data: { type: 'text_delta', delta: 'x'.repeat(2_100) } },
    ]);

    expect(explanation).toHaveLength(2_003);
    expect(explanation?.endsWith('...')).toBe(true);
  });
});
