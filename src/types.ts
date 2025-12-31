export type ToolName = 'claude' | 'codex' | 'gemini';

export interface ToolInfo {
  name: ToolName;
  command: string;
  version: string;
  path: string;
}

export interface SpecMetadata {
  id: string;
  name: string;
  complexity: 'EASY' | 'MODERATE' | 'HIGH';
  maturity: number;
  dependsOn?: string[];
}

export type SpecStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

export interface SpecEntry {
  file: string;
  path: string;
  meta: SpecMetadata;
  status: SpecStatus;
  cycles: Cycle[];
  startedAt?: string;
  completedAt?: string;
  contextOnly?: boolean;
  lastError?: string;
}

export type SessionStatus = 'pending' | 'in_progress' | 'completed' | 'partial' | 'failed' | 'abandoned';

export interface SessionConfig {
  maxIterations: number;
  timeoutPerCycle: number;
  leadPermissions?: string[];
  sandbox: boolean;
  stopOnFailure: boolean;
  verbose: boolean;
  quiet: boolean;
  preflight: boolean;
  preflightThreshold: number;
  preflightIterations: number;
}

export interface Session {
  id: string;
  workingDirectory: string;
  specsDirectory: string;
  lead: ToolName;
  validators: ToolName[];
  config: SessionConfig;
  status: SessionStatus;
  currentSpecIndex: number;
  specs: SpecEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface Cycle {
  number: number;
  specId: string;
  startedAt: string;
  completedAt?: string;
  leadExecution: LeadExecution;
  validations: Validation[];
  consensusReached: boolean;
}

export interface LeadExecution {
  tool: ToolName;
  prompt: string;
  output: string;
  filesModified: string[];
  durationMs: number;
  exitCode: number;
}

export interface Validation {
  tool: ToolName;
  prompt: string;
  output: string;
  parsed: ValidationResult;
  durationMs: number;
  exitCode: number;
}

export interface ValidationResult {
  completeness: number;
  status: 'PASS' | 'FAIL';
  gaps: string[];
  recommendations: string[];
}

export interface ToolRegistry {
  available: Map<ToolName, ToolInfo>;
}

export interface RunOptions {
  specs?: string;
  exclude?: string;
  lead?: ToolName;
  validators?: string;
  maxIterations: number;
  timeout: number;
  resume: boolean;
  stopOnFailure: boolean;
  leadPermissions?: string;
  sandbox: boolean;
  interactive: boolean;
  verbose: boolean;
  heartbeat: number;
  quiet: boolean;
  dryRun: boolean;
  preflight: boolean;
  preflightThreshold: number;
  preflightIterations: number;
}

export interface RunContext {
  cwd: string;
  output: NodeJS.WritableStream;
  errorOutput: NodeJS.WritableStream;
  env: NodeJS.ProcessEnv;
}

export interface ValidationSummary {
  status: 'PASS' | 'FAIL';
  completeness: number;
  gaps: string[];
  recommendations: string[];
}

export interface ExecutionResult {
  output: string;
  exitCode: number;
  durationMs: number;
  streamed: boolean;
}

export interface ToolRunner {
  runLead(tool: ToolName, prompt: string, cwd: string, timeoutMs: number): Promise<ExecutionResult>;
  runValidator(tool: ToolName, prompt: string, cwd: string, timeoutMs: number): Promise<ExecutionResult>;
}
