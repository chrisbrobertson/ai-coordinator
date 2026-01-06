import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createOutputBuffer, createTempDir } from '../helpers';

const runCoordinator = vi.fn();
const runValidationOnly = vi.fn();

vi.mock('../../src/orchestration/run', () => ({
  runCoordinator,
  runValidationOnly
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
        '--max-iterations-per-run',
        '4',
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
        '--start-over',
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
      maxIterationsPerRun: 4,
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
      preflight: false,
      startOver: true
    });
  });

  it('parses validate flags', async () => {
    runValidationOnly.mockResolvedValue(undefined);
    const { runCli } = await import('../../src/cli/cli');
    const stdout = createOutputBuffer();
    const stderr = createOutputBuffer();
    const cwd = await createTempDir('aic-cli-validate-');

    await runCli({
      argv: [
        'validate',
        '--specs',
        'feat-*.md',
        '--exclude',
        'system-*.md',
        '--validators',
        'claude,codex',
        '--timeout',
        '15',
        '--verbose',
        '--heartbeat',
        '3',
        '--quiet'
      ],
      cwd,
      stdout: stdout.stream,
      stderr: stderr.stream,
      env: process.env
    });

    expect(runValidationOnly).toHaveBeenCalledTimes(1);
    const [options] = runValidationOnly.mock.calls[0];
    expect(options).toMatchObject({
      specs: 'feat-*.md',
      exclude: 'system-*.md',
      validators: 'claude,codex',
      timeout: 15,
      verbose: true,
      heartbeat: 3,
      quiet: true
    });
  });
});
