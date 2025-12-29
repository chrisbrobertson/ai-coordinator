import { execa } from 'execa';
import { ExecutionResult, ToolName, ToolRunner } from '../types';
import { getToolDefinition } from './tool-definitions';

export class DefaultToolRunner implements ToolRunner {
  async runLead(tool: ToolName, prompt: string, cwd: string, timeoutMs: number): Promise<ExecutionResult> {
    const definition = getToolDefinition(tool);
    const args = [...definition.leadArgs];
    if (definition.name === 'claude') {
      args.push(prompt);
    } else if (definition.name === 'codex') {
      args.push(prompt);
    } else {
      args.push(prompt);
    }
    return this.execute(definition.command, args, cwd, timeoutMs);
  }

  async runValidator(tool: ToolName, prompt: string, cwd: string, timeoutMs: number): Promise<ExecutionResult> {
    const definition = getToolDefinition(tool);
    const args = [...definition.validatorArgs];
    if (definition.name === 'claude') {
      args.push(prompt);
    } else if (definition.name === 'codex') {
      args.push(prompt);
    } else {
      args.push(prompt);
    }
    return this.execute(definition.command, args, cwd, timeoutMs);
  }

  private async execute(command: string, args: string[], cwd: string, timeoutMs: number): Promise<ExecutionResult> {
    const startedAt = Date.now();
    try {
      const result = await execa(command, args, { cwd, timeout: timeoutMs, reject: false });
      const durationMs = Date.now() - startedAt;
      const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');
      return { output: combined, exitCode: result.exitCode ?? 0, durationMs };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const output = error instanceof Error ? error.message : 'Unknown error';
      return { output, exitCode: 1, durationMs };
    }
  }
}
