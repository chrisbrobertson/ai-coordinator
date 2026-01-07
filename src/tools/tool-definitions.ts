import { ToolName } from '../types.js';

export interface ToolDefinition {
  name: ToolName;
  command: string;
  leadArgs: string[];
  validatorArgs: string[];
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'claude',
    command: 'claude',
    leadArgs: ['--dangerously-skip-permissions', '-p', '--output-format', 'json'],
    validatorArgs: ['--allowedTools', 'View,Read,Grep,Glob,LS', '-p', '--output-format', 'json']
  },
  {
    name: 'codex',
    command: 'codex',
    leadArgs: ['exec', '--color', 'never', '--full-auto', '--json'],
    validatorArgs: ['exec', '--color', 'never', '--json']
  },
  {
    name: 'gemini',
    command: 'gemini',
    leadArgs: ['--output-format', 'json'],
    validatorArgs: ['--output-format', 'json', '--allowed-tools', 'View,Read,Grep,Glob,LS']
  }
];

export function getToolDefinition(name: ToolName): ToolDefinition {
  const definition = TOOL_DEFINITIONS.find((tool) => tool.name === name);
  if (!definition) {
    throw new Error(`Unsupported tool: ${name}`);
  }
  return definition;
}
