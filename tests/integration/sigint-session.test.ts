import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { runCoordinator } from '../../src/orchestration/run';
import { createTempDir, makeExecutable } from '../helpers';
import { RunOptions, ExecutionResult, ToolName } from '../../src/types';

const specContent = `---\nspecmas: v3\nkind: FeatureSpec\nid: feat-core\nname: Core\nversion: 1.0.0\ncomplexity: EASY\nmaturity: 3\n---\n# Core`;

class HangingRunner {
  private leadResolve?: (value: ExecutionResult) => void;
  private leadStartedResolve?: () => void;
  leadStarted = new Promise<void>((resolve) => {
    this.leadStartedResolve = resolve;
  });

  async runLead(_tool: ToolName, _prompt: string, _cwd: string, _timeoutMs: number): Promise<ExecutionResult> {
    return new Promise<ExecutionResult>((resolve) => {
      this.leadResolve = resolve;
      this.leadStartedResolve?.();
    });
  }

  async runValidator(): Promise<ExecutionResult> {
    return {
      output: 'COMPLETENESS: 100%\nSTATUS: PASS\nGAPS:\n- None\nRECOMMENDATIONS:\n- None',
      exitCode: 0,
      durationMs: 5,
      streamed: false
    };
  }

  resolveLead() {
    this.leadResolve?.({ output: 'done', exitCode: 0, durationMs: 5, streamed: false });
  }
}

describe('SIGINT handling', () => {
  it('persists session state on interrupt', async () => {
    const projectDir = await createTempDir('aic-project-');
    const specsDir = path.join(projectDir, 'specs');
    await fs.mkdir(specsDir, { recursive: true });
    await fs.writeFile(path.join(specsDir, 'feat-core.md'), specContent, 'utf8');

    const binDir = await createTempDir('aic-bin-');
    const fakeTool = `#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo \"tool 1.0.0\"\n  exit 0\nfi\nexit 0\n`;
    await makeExecutable(path.join(binDir, 'claude'), fakeTool);
    await makeExecutable(path.join(binDir, 'codex'), fakeTool);

    const options: RunOptions = {
      specs: undefined,
      exclude: undefined,
      lead: undefined,
      validators: undefined,
      maxIterations: 1,
      timeout: 1,
      resume: false,
      stopOnFailure: false,
      leadPermissions: undefined,
      sandbox: false,
      interactive: false,
      verbose: false,
      heartbeat: 0,
      quiet: true,
      dryRun: false,
      preflight: true,
      preflightThreshold: 70,
      preflightIterations: 2
    };

    const runner = new HangingRunner();
    const originalExit = process.exit;
    // Prevent the SIGINT handler from exiting the test process.
    process.exit = (() => undefined) as unknown as typeof process.exit;

    const runPromise = runCoordinator(options, {
      cwd: projectDir,
      output: process.stdout,
      errorOutput: process.stderr,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        AIC_NO_EXIT: '1'
      }
    }, { runner });

    await runner.leadStarted;
    process.emit('SIGINT');
    runner.resolveLead();
    await runPromise;

    process.exit = originalExit;

    const sessionIdPath = path.join(projectDir, '.ai-coord', 'session');
    const sessionId = (await fs.readFile(sessionIdPath, 'utf8')).trim();
    const sessionFile = path.join(projectDir, '.ai-coord', 'sessions', `${sessionId}.json`);
    const sessionExists = await fs.stat(sessionFile).then(() => true).catch(() => false);
    expect(sessionExists).toBe(true);
  });
});
