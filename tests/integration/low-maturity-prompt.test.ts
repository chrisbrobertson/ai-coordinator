import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import { runCoordinator } from '../../src/orchestration/run';
import { createTempDir, makeExecutable, createOutputBuffer } from '../helpers';
import { RunOptions, ExecutionResult, ToolName } from '../../src/types';

const specContent = `---\nspecmas: v3\nkind: FeatureSpec\nid: feat-core\nname: Core\nversion: 1.0.0\ncomplexity: EASY\nmaturity: 2\n---\n# Core`;

class MockRunner {
  async runLead(_tool: ToolName, _prompt: string, _cwd: string, _timeoutMs: number): Promise<ExecutionResult> {
    return { output: 'done', exitCode: 0, durationMs: 5, streamed: false };
  }
  async runValidator(): Promise<ExecutionResult> {
    return {
      output: 'COMPLETENESS: 100%\nSTATUS: PASS\nGAPS:\n- None\nRECOMMENDATIONS:\n- None',
      exitCode: 0,
      durationMs: 5,
      streamed: false
    };
  }
}

async function withMockedStdin(input: string, fn: () => Promise<void>) {
  const readable = new Readable({
    read() {
      this.push(input);
      this.push(null);
    }
  });
  const original = process.stdin;
  Object.defineProperty(process, 'stdin', { value: readable, configurable: true });
  try {
    await fn();
  } finally {
    Object.defineProperty(process, 'stdin', { value: original, configurable: true });
  }
}

describe('low maturity prompt', () => {
  it('aborts when user declines', async () => {
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
      quiet: false,
      dryRun: false,
      preflight: true,
      preflightThreshold: 70,
      preflightIterations: 2,
      startOver: false
    };

    const out = createOutputBuffer();
    const err = createOutputBuffer();

    await expect(
      withMockedStdin('n\n', async () => {
        await runCoordinator(options, {
          cwd: projectDir,
          output: out.stream,
          errorOutput: err.stream,
          env: {
            ...process.env,
            PATH: `${binDir}:${process.env.PATH}`,
            AIC_TEST_MODE: '0'
          }
        }, { runner: new MockRunner() });
      })
    ).rejects.toThrow('Aborted due to low spec maturity.');
  });

  it('continues when user accepts', async () => {
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
      quiet: false,
      dryRun: false,
      preflight: true,
      preflightThreshold: 70,
      preflightIterations: 2,
      startOver: false
    };

    const out = createOutputBuffer();
    const err = createOutputBuffer();

    await withMockedStdin('y\n', async () => {
      await runCoordinator(options, {
        cwd: projectDir,
        output: out.stream,
        errorOutput: err.stream,
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`,
          AIC_TEST_MODE: '0'
        }
      }, { runner: new MockRunner() });
    });

    expect(out.output).toContain('Specs to build');
  });
});
