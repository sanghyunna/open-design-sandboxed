import readline from 'node:readline';

type JsonObject = Record<string, unknown>;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: JsonObject;
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: JsonObject;
}

interface McpServerResult {
  exitCode: number;
}

const CONNECTORS_LIST_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    useCase: { type: 'string', enum: ['personal_daily_digest'] },
  },
} satisfies JsonObject;

export function createConnectorsMcpTools(): McpTool[] {
  return [
    {
      name: 'connectors_list',
      description: 'List connector catalog and available read-only tools through the daemon tool endpoint. Use `{ "useCase": "personal_daily_digest" }` for curated daily-digest tools. POSIX equivalent: `"$OD_NODE_BIN" "$OD_BIN" tools connectors list --use-case personal_daily_digest --format compact` or fallback `"$OD_NODE_BIN" "$OD_BIN" tools connectors list --format compact`.',
      inputSchema: CONNECTORS_LIST_INPUT_SCHEMA,
    },
    {
      name: 'connectors_execute',
      description: 'Execute an allowed connector read tool through the daemon tool endpoint. POSIX equivalent: `"$OD_NODE_BIN" "$OD_BIN" tools connectors execute --connector <id> --tool <name> --input input.json`.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['connectorId', 'toolName', 'input'],
        properties: {
          connectorId: { type: 'string', minLength: 1 },
          toolName: { type: 'string', minLength: 1 },
          input: { type: 'object', additionalProperties: true },
        },
      },
    },
  ];
}

function daemonUrl(): URL {
  const rawUrl = process.env.OD_DAEMON_URL;
  if (!rawUrl) throw new Error('OD_DAEMON_URL is required');
  const url = new URL(rawUrl);
  url.pathname = url.pathname.replace(/\/+$/u, '');
  url.search = '';
  url.hash = '';
  return url;
}

function toolToken(): string {
  const token = process.env.OD_TOOL_TOKEN;
  if (!token) throw new Error('OD_TOOL_TOKEN is required');
  return token;
}

function endpoint(baseUrl: URL, pathname: string): string {
  const url = new URL(baseUrl.toString());
  const [pathPart, searchPart] = pathname.split('?');
  url.pathname = `${url.pathname}${pathPart ?? ''}`.replace(/\/+/gu, '/');
  url.search = searchPart === undefined ? '' : `?${searchPart}`;
  return url.toString();
}

async function requestJson(pathname: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(endpoint(daemonUrl(), pathname), {
    ...init,
    headers: {
      Authorization: `Bearer ${toolToken()}`,
      Accept: 'application/json',
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...init.headers,
    },
  });
  const text = await response.text();
  let body: unknown = text;
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = { message: text };
    }
  }
  if (!response.ok) {
    const error = new Error(`daemon tool endpoint failed with ${response.status}`);
    (error as Error & { details?: unknown }).details = body;
    throw error;
  }
  return body;
}

async function callTool(name: string, args: JsonObject): Promise<unknown> {
  if (name === 'connectors_list') {
    const useCase = args.useCase === 'personal_daily_digest' ? '?useCase=personal_daily_digest' : '';
    return await requestJson(`/api/tools/connectors/list${useCase}`, { method: 'GET' });
  }
  if (name === 'connectors_execute') {
    return await requestJson('/api/tools/connectors/execute', {
      method: 'POST',
      body: JSON.stringify({ connectorId: args.connectorId, toolName: args.toolName, input: args.input ?? {} }),
    });
  }
  throw new Error(`unknown MCP tool: ${name}`);
}

export async function handleConnectorsMcpRequest(request: JsonRpcRequest): Promise<JsonObject | undefined> {
  const id = request.id ?? null;
  const method = request.method;

  if (method === 'notifications/initialized') return undefined;

  try {
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'open-design-connectors', version: '0.1.0' },
        },
      };
    }

    if (method === 'tools/list') {
      return { jsonrpc: '2.0', id, result: { tools: createConnectorsMcpTools() } };
    }

    if (method === 'tools/call') {
      const params = request.params ?? {};
      const name = typeof params.name === 'string' ? params.name : '';
      const args = params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? (params.arguments as JsonObject) : {};
      const result = await callTool(name, args);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        },
      };
    }

    return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${String(method)}` } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const details = error && typeof error === 'object' && 'details' in error ? (error as { details?: unknown }).details : undefined;
    return { jsonrpc: '2.0', id, error: { code: -32000, message, ...(details === undefined ? {} : { data: details }) } };
  }
}

export async function runConnectorsMcpServer(): Promise<McpServerResult> {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line) as JsonRpcRequest;
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })}\n`);
      continue;
    }
    const response = await handleConnectorsMcpRequest(request);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  }

  return { exitCode: 0 };
}
