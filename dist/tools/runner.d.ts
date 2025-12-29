import { ExecutionResult, ToolName, ToolRunner } from '../types.js';
export declare class DefaultToolRunner implements ToolRunner {
    runLead(tool: ToolName, prompt: string, cwd: string, timeoutMs: number): Promise<ExecutionResult>;
    runValidator(tool: ToolName, prompt: string, cwd: string, timeoutMs: number): Promise<ExecutionResult>;
    private execute;
}
