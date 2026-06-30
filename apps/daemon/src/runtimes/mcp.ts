import type { RuntimeAgentDef } from './types.js';

type McpOptions = {
  enabled?: boolean;
  command?: string;
  argsPrefix?: string[];
};

export function buildConnectorsMcpServersForAgent(
  def: RuntimeAgentDef,
  { enabled = true, command = 'od', argsPrefix = [] }: McpOptions = {},
) {
  if (!enabled || def?.mcpDiscovery !== 'mature-acp') return [];
  return [
    {
      name: 'open-design-connectors',
      command,
      args: [...argsPrefix, 'mcp', 'connectors'],
      env: [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }],
    },
  ];
}
