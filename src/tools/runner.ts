import { execa } from 'execa';
import { ExecutionResult, ToolName, ToolRunner } from '../types.js';
import { getToolDefinition } from './tool-definitions.js';

export interface RunnerConfig {
  interactive: boolean;
  leadPermissions?: string[];
  sandbox: boolean;
  sandboxImage: string;
  verbose: boolean;
  output: NodeJS.WritableStream;
  inheritStdin: boolean;
  onSpawn?: (info: {
    child: ReturnType<typeof execa>;
    command: string;
    args: string[];
  }) => void;
  onWarning?: (message: string) => void;
}

export class DefaultToolRunner implements ToolRunner {
  private config: RunnerConfig;

  constructor(config: RunnerConfig) {
    this.config = config;
  }

  async runLead(tool: ToolName, prompt: string, cwd: string, timeoutMs: number): Promise<ExecutionResult> {
    const definition = getToolDefinition(tool);
    const args = this.buildLeadArgs(definition, prompt);
    return this.execute(definition.command, args, cwd, timeoutMs);
  }

  async runValidator(tool: ToolName, prompt: string, cwd: string, timeoutMs: number): Promise<ExecutionResult> {
    const definition = getToolDefinition(tool);
    const args = this.buildValidatorArgs(definition, prompt);
    const result = await this.execute(definition.command, args, cwd, timeoutMs);
    if (result.exitCode === 0 || this.config.interactive) {
      return result;
    }
    if (this.config.onWarning) {
      this.config.onWarning(`Validator ${definition.name} did not accept read-only flags; falling back to full permissions.`);
    }
    return this.execute(definition.command, [prompt], cwd, timeoutMs);
  }

  private async execute(command: string, args: string[], cwd: string, timeoutMs: number): Promise<ExecutionResult> {
    const startedAt = Date.now();
    let streamed = false;
    try {
      const needsTtyStdin = (command === 'codex' || command === 'cortex') && process.stdin.isTTY;
      const stdinMode = this.config.inheritStdin || needsTtyStdin ? 'inherit' : 'pipe';
      const stdio = {
        stdin: stdinMode
      } as const;
      const dockerArgs = this.config.sandbox
        ? [
          'run',
          '--rm',
          ...(this.config.inheritStdin ? ['-i'] : []),
          ...(this.config.inheritStdin && process.stdin.isTTY ? ['-t'] : []),
          '-v',
          `${cwd}:/workspace`,
          '-w',
          '/workspace',
          this.config.sandboxImage,
          command,
          ...args
        ]
        : null;
      const needsPty = (command === 'codex' || command === 'cortex')
        && (!process.stdin.isTTY || !process.stdout.isTTY)
        && !this.config.sandbox;
      const finalCommand = needsPty ? 'script' : this.config.sandbox ? 'docker' : command;
      const finalArgs = needsPty
        ? ['-q', '/dev/null', '--', command, ...args]
        : this.config.sandbox
          ? (dockerArgs ?? [])
          : args;
      const subprocess = execa(finalCommand, finalArgs, {
        cwd,
        timeout: timeoutMs,
        reject: false,
        ...stdio
      });
      if (this.config.onSpawn) {
        this.config.onSpawn({ child: subprocess, command: finalCommand, args: finalArgs });
      }
      let stdout = '';
      let stderr = '';
      if (subprocess.stdout) {
        subprocess.stdout.on('data', (chunk) => {
          const text = chunk.toString();
          stdout += text;
          if (this.config.verbose) {
            streamed = true;
            this.config.output.write(text);
          }
        });
      }
      if (subprocess.stderr) {
        subprocess.stderr.on('data', (chunk) => {
          const text = chunk.toString();
          stderr += text;
          if (this.config.verbose) {
            streamed = true;
            this.config.output.write(text);
          }
        });
      }
      const result = await subprocess;
      const durationMs = Date.now() - startedAt;
      const combined = [stdout || result.stdout, stderr || result.stderr].filter(Boolean).join('\n');
      return { output: combined, exitCode: result.exitCode ?? 0, durationMs, streamed };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const output = error instanceof Error ? error.message : 'Unknown error';
      return { output, exitCode: 1, durationMs, streamed };
    }
  }

  private buildLeadArgs(definition: ReturnType<typeof getToolDefinition>, prompt: string): string[] {
    if (this.config.interactive) {
      return [prompt];
    }
    if (definition.name === 'claude' && this.config.leadPermissions && this.config.leadPermissions.length > 0) {
      return ['--allowedTools', this.config.leadPermissions.join(','), '-p', prompt];
    }
    if (definition.name !== 'claude' && this.config.leadPermissions && this.config.onWarning) {
      this.config.onWarning(`Lead permissions override is not supported for ${definition.name}; using default permissions.`);
    }
    return [...definition.leadArgs, prompt];
  }

  private buildValidatorArgs(definition: ReturnType<typeof getToolDefinition>, prompt: string): string[] {
    if (this.config.interactive) {
      return [prompt];
    }
    return [...definition.validatorArgs, prompt];
  }
}
