import { RunContext, RunOptions, ToolRunner, ValidationResult } from '../types.js';
export interface RunDependencies {
    runner?: ToolRunner;
}
export interface ValidationOnlyOptions {
    specs?: string;
    exclude?: string;
    timeout: number;
    verbose: boolean;
    heartbeat: number;
    quiet: boolean;
}
export declare function runCoordinator(options: RunOptions, context: RunContext, deps?: RunDependencies): Promise<void>;
export declare function runValidationOnly(options: ValidationOnlyOptions, context: RunContext, deps?: RunDependencies): Promise<void>;
export declare function parseValidationOutput(output: string): ValidationResult;
export declare function hasConsensus(validations: ValidationResult[]): boolean;
