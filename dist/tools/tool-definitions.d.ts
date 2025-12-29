import { ToolName } from '../types.js';
export interface ToolDefinition {
    name: ToolName;
    command: string;
    leadArgs: string[];
    validatorArgs: string[];
}
export declare const TOOL_DEFINITIONS: ToolDefinition[];
export declare function getToolDefinition(name: ToolName): ToolDefinition;
