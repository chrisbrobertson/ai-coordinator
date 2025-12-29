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
    leadArgs: ['--dangerously-skip-permissions', '-p'],
    validatorArgs: ['--allowedTools', 'View,Read,Grep,Glob,LS', '-p']
  },
  {
    name: 'codex',
    command: 'codex',
    leadArgs: ['--approval-mode', 'full-auto'],
    validatorArgs: ['--approval-mode', 'read-only']
  },
  {
    name: 'gemini',
    command: 'gemini',
    leadArgs: ['--non-interactive', 'prompt'],
    validatorArgs: ['--non-interactive', '--read-only', 'prompt']
  }
];

export function getToolDefinition(name: ToolName): ToolDefinition {
  const definition = TOOL_DEFINITIONS.find((tool) => tool.name === name);
  if (!definition) {
    throw new Error(`Unsupported tool: ${name}`);
  }
  return definition;
}
