import { Command } from 'commander';
export interface CliRunOptions {
    argv: string[];
    cwd?: string;
    stdout?: NodeJS.WritableStream;
    stderr?: NodeJS.WritableStream;
    env?: NodeJS.ProcessEnv;
}
export declare function runCli(options: CliRunOptions): Promise<void>;
export declare function createProgram(): Command;
