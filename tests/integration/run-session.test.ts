import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { runCoordinator } from '../../src/orchestration/run';
import { createTempDir, makeExecutable } from '../helpers';
import { RunOptions } from '../../src/types';

const specContent = `---\nspecmas: v3\nkind: FeatureSpec\nid: feat-core\nname: Core\nversion: 1.0.0\ncomplexity: EASY\nmaturity: 3\n---\n# Core`;

class MockRunner {
  async runLead(_tool: string, _prompt: string, _cwd: string, _timeoutMs: number) {
    return { output: 'done', exitCode: 0, durationMs: 5 };
  }
  async runValidator(_tool: string, _prompt: string, _cwd: string, _timeoutMs: number) {
    return {
      output: 'COMPLETENESS: 100%\nSTATUS: PASS\nGAPS:\n- None\nRECOMMENDATIONS:\n- None',
      exitCode: 0,
      durationMs: 5
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
      dryRun: false
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

    const reportPath = path.join(stateDir, 'reports');
    const reportFiles = await fs.readdir(reportPath);
    expect(reportFiles.length).toBe(1);
  });
});
