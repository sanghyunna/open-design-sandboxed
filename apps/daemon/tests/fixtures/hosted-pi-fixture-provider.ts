type FixtureProviderApi = {
  registerProvider(provider: unknown): void;
};

type StreamOptions = { signal?: AbortSignal };

const usage = {
  input: 3,
  output: 2,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 5,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function message(stopReason: 'stop' | 'aborted' = 'stop') {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: stopReason === 'stop' ? 'hosted fixture response' : '' }],
    api: 'openai-completions',
    provider: 'hosted-fixture',
    model: 'fixture-model',
    usage,
    stopReason,
    timestamp: Date.now(),
  };
}

function stream(options?: StreamOptions) {
  let final = message();
  const pause = () => new Promise((resolve) => setTimeout(resolve, 250));
  const events = async function* () {
    if (options?.signal?.aborted) {
      final = message('aborted');
      yield { type: 'error', reason: 'aborted', error: final };
      return;
    }
    yield { type: 'start', partial: final };
    await pause();
    if (options?.signal?.aborted) {
      final = message('aborted');
      yield { type: 'error', reason: 'aborted', error: final };
      return;
    }
    yield { type: 'text_start', contentIndex: 0, partial: final };
    await pause();
    yield { type: 'text_delta', contentIndex: 0, delta: 'hosted fixture response', partial: final };
    await pause();
    yield { type: 'text_end', contentIndex: 0, content: 'hosted fixture response', partial: final };
    await pause();
    yield { type: 'done', reason: 'stop', message: final };
  };
  return {
    [Symbol.asyncIterator]: events,
    result: async () => final,
  };
}

export default function hostedPiFixtureProvider(pi: FixtureProviderApi): void {
  pi.registerProvider({
    id: 'hosted-fixture',
    name: 'Hosted fixture',
    auth: {
      apiKey: {
        name: 'Hosted fixture',
        check: async () => ({ type: 'api_key', source: 'fixture' }),
        resolve: async () => ({ auth: { apiKey: 'fixture' }, source: 'fixture' }),
      },
    },
    getModels: () => [{
      id: 'fixture-model',
      name: 'Hosted fixture',
      api: 'openai-completions',
      provider: 'hosted-fixture',
      baseUrl: 'http://127.0.0.1',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 4096,
      maxTokens: 256,
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        supportsUsageInStreaming: true,
        supportsStrictMode: false,
        maxTokensField: 'max_tokens',
      },
    }],
    stream: (_model: unknown, _context: unknown, options?: StreamOptions) => stream(options),
    streamSimple: (_model: unknown, _context: unknown, options?: StreamOptions) => stream(options),
  });
}
