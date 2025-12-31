import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { runCoordinator } from '../../src/orchestration/run';
import { createTempDir, makeExecutable } from '../helpers';
import { RunOptions } from '../../src/types';

const specContent = `---\nspecmas: v3\nkind: FeatureSpec\nid: feat-core\nname: Core\nversion: 1.0.0\ncomplexity: EASY\nmaturity: 3\n---\n# Core`;

class MockRunner {
  async runLead(_tool: string, _prompt: string, _cwd: string, _timeoutMs: number) {
    return { output: 'done', exitCode: 0, durationMs: 5, streamed: false };
  }
  async runValidator(_tool: string, _prompt: string, _cwd: string, _timeoutMs: number) {
    return {
      output: 'COMPLETENESS: 100%\nSTATUS: PASS\nGAPS:\n- None\nRECOMMENDATIONS:\n- None',
      exitCode: 0,
      durationMs: 5,
      streamed: false
    };
  }
}

describe('runCoordinator integration', () => {
  it('creates session and report', async () => {
    const projectDir = await createTempDir('aic-project-');
    const specsDir = path.join(projectDir, 'specs');
    await fs.mkdir(specsDir, { recursive: true });
    await fs.writeFile(path.join(specsDir, 'feat-core.md'), specContent, 'utf8');

    const binDir = await createTempDir('aic-bin-');
    const fakeTool = `#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo \"tool 1.0.0\"\n  exit 0\nfi\nexit 0\n`;
    await makeExecutable(path.join(binDir, 'claude'), fakeTool);
    await makeExecutable(path.join(binDir, 'codex'), fakeTool);

    const stateDir = await createTempDir('aic-state-');

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
      quiet: true,
      dryRun: false,
      preflight: true,
      preflightThreshold: 70,
      preflightIterations: 2,
      startOver: false
    };

    await runCoordinator(options, {
      cwd: projectDir,
      output: process.stdout,
      errorOutput: process.stderr,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        AIC_STATE_DIR: stateDir
      }
    }, { runner: new MockRunner() });

    const reportPath = path.join(projectDir, '.ai-coord', 'reports');
    const reportFiles = await fs.readdir(reportPath);
    expect(reportFiles.length).toBe(3);
    expect(reportFiles.some((file) => file.includes('-codex'))).toBe(true);
  });

  it('marks spec failed when lead returns no output', async () => {
    const projectDir = await createTempDir('aic-project-');
    const specsDir = path.join(projectDir, 'specs');
    await fs.mkdir(specsDir, { recursive: true });
    await fs.writeFile(path.join(specsDir, 'feat-core.md'), specContent, 'utf8');

    const binDir = await createTempDir('aic-bin-');
    const fakeTool = `#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo \"tool 1.0.0\"\n  exit 0\nfi\nexit 0\n`;
    await makeExecutable(path.join(binDir, 'claude'), fakeTool);
    await makeExecutable(path.join(binDir, 'codex'), fakeTool);

    const stateDir = await createTempDir('aic-state-');

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
      quiet: true,
      dryRun: false,
      preflight: true,
      preflightThreshold: 70,
      preflightIterations: 2,
      startOver: false
    };

    const runner = {
      async runLead() {
        return { output: '', exitCode: 1, durationMs: 5, streamed: false };
      },
      async runValidator() {
        return {
          output: 'COMPLETENESS: 100%\\nSTATUS: PASS\\nGAPS:\\n- None\\nRECOMMENDATIONS:\\n- None',
          exitCode: 0,
          durationMs: 5,
          streamed: false
        };
      }
    };

    await expect(
      runCoordinator(options, {
        cwd: projectDir,
        output: process.stdout,
        errorOutput: process.stderr,
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`,
          AIC_STATE_DIR: stateDir
        }
      }, { runner })
    ).rejects.toThrow('returned no output');

    const sessionsDir = path.join(projectDir, '.ai-coord', 'sessions');
    const sessionFiles = await fs.readdir(sessionsDir);
    expect(sessionFiles.length).toBeGreaterThan(0);
    const content = await fs.readFile(path.join(sessionsDir, sessionFiles[0]), 'utf8');
    const parsed = JSON.parse(content) as { specs: Array<{ status: string; lastError?: string }> };
    expect(parsed.specs[0]?.status).toBe('failed');
    expect(parsed.specs[0]?.lastError).toBeTruthy();
  });

  it('resumes previous session by default when consensus not reached', async () => {
    const projectDir = await createTempDir('aic-project-');
    const specsDir = path.join(projectDir, 'specs');
    await fs.mkdir(specsDir, { recursive: true });
    await fs.writeFile(path.join(specsDir, 'feat-core.md'), specContent, 'utf8');

    const binDir = await createTempDir('aic-bin-');
    const fakeTool = `#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo \"tool 1.0.0\"\n  exit 0\nfi\nexit 0\n`;
    await makeExecutable(path.join(binDir, 'claude'), fakeTool);
    await makeExecutable(path.join(binDir, 'codex'), fakeTool);

    const priorSession = {
      id: 'session-prev',
      workingDirectory: projectDir,
      specsDirectory: specsDir,
      specs: [
        {
          file: 'feat-core.md',
          path: path.join(specsDir, 'feat-core.md'),
          meta: {
            id: 'feat-core',
            name: 'Core',
            complexity: 'EASY',
            maturity: 3
          },
          status: 'failed',
          cycles: []
        }
      ],
      lead: 'claude',
      validators: ['codex'],
      config: {
        maxIterations: 1,
        timeoutPerCycle: 1,
        sandbox: false,
        stopOnFailure: false,
        verbose: false,
        quiet: true,
        preflight: true,
        preflightThreshold: 70,
        preflightIterations: 2
      },
      status: 'partial',
      currentSpecIndex: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await fs.mkdir(path.join(projectDir, '.ai-coord', 'sessions'), { recursive: true });
    await fs.writeFile(
      path.join(projectDir, '.ai-coord', 'sessions', `${priorSession.id}.json`),
      JSON.stringify(priorSession, null, 2),
      'utf8'
    );
    await fs.writeFile(path.join(projectDir, '.ai-coord', 'session'), priorSession.id, 'utf8');

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
      quiet: true,
      dryRun: false,
      preflight: true,
      preflightThreshold: 70,
      preflightIterations: 2,
      startOver: false
    };

    const runner = {
      async runLead() {
        return { output: 'done', exitCode: 0, durationMs: 5, streamed: false };
      },
      async runValidator() {
        return {
          output: 'COMPLETENESS: 100%\\nSTATUS: PASS\\nGAPS:\\n- None\\nRECOMMENDATIONS:\\n- None',
          exitCode: 0,
          durationMs: 5,
          streamed: false
        };
      }
    };

    await runCoordinator(options, {
      cwd: projectDir,
      output: process.stdout,
      errorOutput: process.stderr,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        AIC_TEST_MODE: '1'
      }
    }, { runner });

    const updated = await fs.readFile(path.join(projectDir, '.ai-coord', 'sessions', `${priorSession.id}.json`), 'utf8');
    const parsed = JSON.parse(updated) as { specs: Array<{ status: string }> };
    expect(parsed.specs[0]?.status).toBe('completed');
  });
});
