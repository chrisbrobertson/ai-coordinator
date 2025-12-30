import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createOutputBuffer, createTempDir } from '../helpers';

const runCoordinator = vi.fn();

vi.mock('../../src/orchestration/run', () => ({
  runCoordinator
}));

describe('cli run options', () => {
  beforeEach(() => {
    runCoordinator.mockReset();
    runCoordinator.mockResolvedValue(undefined);
  });

  it('parses all run flags', async () => {
    const { runCli } = await import('../../src/cli/cli');
    const stdout = createOutputBuffer();
    const stderr = createOutputBuffer();
    const cwd = await createTempDir('aic-cli-');

    await runCli({
      argv: [
        'run',
        '--specs',
        'feat-*.md',
        '--exclude',
        'system-*.md',
        '--lead',
        'claude',
        '--validators',
        'codex,gemini',
        '--max-iterations',
        '3',
        '--timeout',
        '12',
        '--preflight-threshold',
        '85',
        '--preflight-iterations',
        '1',
        '--resume',
        '--stop-on-failure',
        '--lead-permissions',
        'Read,Write',
        '--sandbox',
        '--interactive',
        '--verbose',
        '--heartbeat',
        '5',
        '--quiet',
        '--dry-run',
        '--no-preflight'
      ],
      cwd,
      stdout: stdout.stream,
      stderr: stderr.stream,
      env: process.env
    });

    expect(runCoordinator).toHaveBeenCalledTimes(1);
    const [options] = runCoordinator.mock.calls[0];
    expect(options).toMatchObject({
      specs: 'feat-*.md',
      exclude: 'system-*.md',
      lead: 'claude',
      validators: 'codex,gemini',
      maxIterations: 3,
      timeout: 12,
      preflightThreshold: 85,
      preflightIterations: 1,
      resume: true,
      stopOnFailure: true,
      leadPermissions: 'Read,Write',
      sandbox: true,
      interactive: true,
      verbose: true,
      heartbeat: 5,
      quiet: true,
      dryRun: true,
      preflight: false
    });
  });
});
