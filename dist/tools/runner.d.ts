import { execa } from 'execa';
import { ExecutionResult, ToolName, ToolRunner } from '../types.js';
export interface RunnerConfig {
    interactive: boolean;
    leadPermissions?: string[];
    sandbox: boolean;
    sandboxImage: string;
    verbose: boolean;
    output: NodeJS.WritableStream;
    inheritStdin: boolean;
    env?: NodeJS.ProcessEnv;
    onSpawn?: (info: {
        child: ReturnType<typeof execa>;
        command: string;
        args: string[];
    }) => void;
    onWarning?: (message: string) => void;
}
export declare class DefaultToolRunner implements ToolRunner {
    private config;
    constructor(config: RunnerConfig);
    runLead(tool: ToolName, prompt: string, cwd: string, timeoutMs: number): Promise<ExecutionResult>;
    runValidator(tool: ToolName, prompt: string, cwd: string, timeoutMs: number): Promise<ExecutionResult>;
    private execute;
    private buildLeadArgs;
    private buildValidatorArgs;
}
