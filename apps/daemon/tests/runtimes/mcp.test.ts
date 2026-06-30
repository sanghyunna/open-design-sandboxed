import { test } from 'vitest';
import { createConnectorsMcpTools, handleConnectorsMcpRequest } from '../../src/mcp-connectors-server.js';
import { AGENT_DEFS, assert, buildConnectorsMcpServersForAgent, hermes } from './helpers/test-helpers.js';

const connectorsMcpServer = {
  name: 'open-design-connectors',
  command: 'od',
  args: ['mcp', 'connectors'],
  env: [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }],
};

test('connectors MCP discovery is limited to mature ACP agents', () => {
  for (const agent of AGENT_DEFS) {
    assert.deepEqual(
      buildConnectorsMcpServersForAgent(agent),
      agent.mcpDiscovery === 'mature-acp' ? [connectorsMcpServer] : [],
    );
  }
});

test('connectors MCP discovery is disabled when run-scoped tool auth is unavailable', () => {
  assert.deepEqual(buildConnectorsMcpServersForAgent(hermes, { enabled: false }), []);
});

test('connectors MCP discovery can use daemon-resolved CLI command', () => {
  assert.deepEqual(
    buildConnectorsMcpServersForAgent(hermes, {
      command: process.execPath,
      argsPrefix: ['/workspace/apps/daemon/dist/cli.js'],
    } as unknown as Parameters<typeof buildConnectorsMcpServersForAgent>[1]),
    [
      {
        name: 'open-design-connectors',
        command: process.execPath,
        args: ['/workspace/apps/daemon/dist/cli.js', 'mcp', 'connectors'],
        env: [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }],
      },
    ],
  );
});

test('MCP-capable agents can discover connector tools', async () => {
  const tools = createConnectorsMcpTools();
  assert.deepEqual(tools.map((tool) => tool.name), [
    'connectors_list',
    'connectors_execute',
  ]);

  for (const tool of tools) {
    assert.equal(typeof tool.description, 'string');
    assert.match(tool.description, /POSIX equivalent: `"\$OD_NODE_BIN" "\$OD_BIN" tools /u);
    assert.equal(tool.inputSchema.type, 'object');
  }

  const initialized = await handleConnectorsMcpRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) as { result: { serverInfo: { name: string }; capabilities: unknown } };
  assert.equal(initialized.result.serverInfo.name, 'open-design-connectors');
  assert.deepEqual(initialized.result.capabilities, { tools: {} });

  const listed = await handleConnectorsMcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) as { result: { tools: Array<{ name: string }> } };
  assert.deepEqual(listed.result.tools.map((tool) => tool.name), tools.map((tool) => tool.name));

  const connectorsListTool = tools.find((tool) => tool.name === 'connectors_list')!;
  const connectorsListProperties = connectorsListTool.inputSchema.properties as Record<string, unknown>;
  assert.deepEqual(Object.keys(connectorsListProperties).sort(), ['useCase']);
});

test('connectors MCP list forwards daily digest use case to daemon tools', async () => {
  process.env.OD_DAEMON_URL = 'http://127.0.0.1:17456/base';
  process.env.OD_TOOL_TOKEN = 'test-tool-token';
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ connectors: [] }), { status: 200 });
  };

  const response = await handleConnectorsMcpRequest({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'connectors_list', arguments: { useCase: 'personal_daily_digest' } },
  }) as { error?: unknown };

  assert.equal(response.error, undefined);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.url, 'http://127.0.0.1:17456/base/api/tools/connectors/list?useCase=personal_daily_digest');
});
