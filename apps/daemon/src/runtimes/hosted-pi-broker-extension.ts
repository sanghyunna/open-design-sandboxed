import { createConnection } from 'node:net';

const MAX_RESPONSE_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;

type BrokerParams = {
  operation: 'project:file:list' | 'project:file:read' | 'project:file:write';
  path?: string;
  content?: string;
};

type BrokerResponse = {
  ok: boolean;
  operation?: string;
  content?: string;
  entries?: string[];
  code?: string;
  message?: string;
};

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

type ExtensionApi = {
  registerTool(tool: {
    name: string;
    label: string;
    description: string;
    promptSnippet: string;
    parameters: Record<string, unknown>;
    execute(
      toolCallId: string,
      params: BrokerParams,
      signal: AbortSignal | undefined,
    ): Promise<ToolResult>;
  }): void;
};

const parameters: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    operation: {
      type: 'string',
      enum: ['project:file:list', 'project:file:read', 'project:file:write'],
    },
    path: { type: 'string' },
    content: { type: 'string' },
  },
  required: ['operation'],
};

function responseText(response: BrokerResponse): string {
  if (!response.ok) return response.message || 'hosted Pi broker rejected the request';
  if (typeof response.content === 'string') return response.content;
  if (Array.isArray(response.entries)) return response.entries.join('\n');
  return 'ok';
}

function callBroker(params: BrokerParams, signal: AbortSignal | undefined): Promise<BrokerResponse> {
  const socketPath = process.env.OD_HOSTED_PI_BROKER_SOCKET;
  const token = process.env.OD_HOSTED_PI_BROKER_TOKEN;
  if (!socketPath || !token) return Promise.reject(new Error('hosted Pi broker is unavailable'));

  return new Promise<BrokerResponse>((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = '';
    let settled = false;
    let timeout: NodeJS.Timeout;
    const finish = (error: Error | null, response?: BrokerResponse): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      socket.destroy();
      if (error) reject(error);
      else if (response) resolve(response);
      else reject(new Error('hosted Pi broker returned no response'));
    };
    const abort = () => finish(new Error('hosted Pi broker request cancelled'));
    timeout = setTimeout(() => finish(new Error('hosted Pi broker timed out')), REQUEST_TIMEOUT_MS);
    timeout.unref?.();
    signal?.addEventListener('abort', abort, { once: true });
    socket.setEncoding('utf8');
    socket.once('connect', () => {
      socket.write(`${JSON.stringify({ ...params, token })}\n`);
    });
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, 'utf8') > MAX_RESPONSE_BYTES) {
        finish(new Error('hosted Pi broker response is too large'));
        return;
      }
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      try {
        const response = JSON.parse(buffer.slice(0, newline)) as BrokerResponse;
        finish(null, response);
      } catch {
        finish(new Error('hosted Pi broker response is invalid'));
      }
    });
    socket.once('error', (error) => finish(error));
  });
}

export default function hostedPiBrokerExtension(pi: ExtensionApi): void {
  pi.registerTool({
    name: 'od_hosted_broker',
    label: 'Project files',
    description: 'Use the daemon-owned project file broker for the current run.',
    promptSnippet: 'daemon-owned project file broker',
    parameters,
    async execute(_toolCallId, params, signal) {
      try {
        const response = await callBroker(params, signal);
        return {
          content: [{ type: 'text', text: responseText(response) }],
          ...(response.ok ? {} : { isError: true }),
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  });
}
