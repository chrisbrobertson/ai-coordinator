import { ToolName, ToolRegistry } from '../types.js';
export declare function detectTools(env?: NodeJS.ProcessEnv): Promise<ToolRegistry>;
export declare function getDefaultLeadOrder(): ToolName[];
