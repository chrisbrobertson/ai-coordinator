import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { runCli } from '../../src/cli/cli';
import { createTempDir, createOutputBuffer } from '../helpers';

function buildSession(id: string, status: string, updatedAt: string, projectDir: string) {
  return {
    id,
    workingDirectory: projectDir,
    specsDirectory: path.join(projectDir, 'specs'),
    lead: 'claude',
    validators: ['codex'],
    config: {
      maxIterations: 5,
      timeoutPerCycle: 10,
      sandbox: false,
      stopOnFailure: false,
      verbose: false,
      quiet: false
    },
    status,
    currentSpecIndex: 0,
    specs: [
      {
        file: 'feat-core.md',
        path: path.join(projectDir, 'specs', 'feat-core.md'),
        meta: {
          id: 'feat-core',
          name: 'Core',
          complexity: 'EASY',
          maturity: 3
        },
        status: status === 'completed' ? 'completed' : 'in_progress',
        cycles: []
      },
      {
        file: 'feat-extra.md',
        path: path.join(projectDir, 'specs', 'feat-extra.md'),
        meta: {
          id: 'feat-extra',
          name: 'Extra',
          complexity: 'MODERATE',
          maturity: 3
        },
        status: 'pending',
        cycles: []
      }
    ],
    createdAt: updatedAt,
    updatedAt
  };
}

describe('cli status', () => {
  it('prints summary and history by default', async () => {
    const projectDir = await createTempDir('aic-status-');
    const stateDir = path.join(projectDir, '.ai-coord', 'sessions');
    await fs.mkdir(stateDir, { recursive: true });

    const currentSession = buildSession('current-session', 'in_progress', '2024-01-02T00:00:00Z', projectDir);
    const previousSession = buildSession('previous-session', 'completed', '2024-01-01T00:00:00Z', projectDir);

    await fs.writeFile(path.join(projectDir, '.ai-coord', 'session'), 'current-session', 'utf8');
    await fs.writeFile(path.join(stateDir, 'current-session.json'), JSON.stringify(currentSession, null, 2), 'utf8');
    await fs.writeFile(path.join(stateDir, 'previous-session.json'), JSON.stringify(previousSession, null, 2), 'utf8');

    const out = createOutputBuffer();
    const err = createOutputBuffer();

    await runCli({
      argv: ['status'],
      cwd: projectDir,
      stdout: out.stream,
      stderr: err.stream
    });

    expect(out.output).toContain('Session: current-session');
    expect(out.output).toContain('Specs: 0/2 completed');
    expect(out.output).toContain('Previous sessions:');
    expect(out.output).toContain('previous-session');
    expect(out.output).not.toContain('cycles:');
  });

  it('prints full status with per-spec details', async () => {
    const projectDir = await createTempDir('aic-status-');
    const stateDir = path.join(projectDir, '.ai-coord', 'sessions');
    await fs.mkdir(stateDir, { recursive: true });

    const currentSession = buildSession('current-session', 'in_progress', '2024-01-02T00:00:00Z', projectDir);
    await fs.writeFile(path.join(projectDir, '.ai-coord', 'session'), 'current-session', 'utf8');
    await fs.writeFile(path.join(stateDir, 'current-session.json'), JSON.stringify(currentSession, null, 2), 'utf8');

    const out = createOutputBuffer();
    const err = createOutputBuffer();

    await runCli({
      argv: ['status', '--full'],
      cwd: projectDir,
      stdout: out.stream,
      stderr: err.stream
    });

    expect(out.output).toContain('Specs:');
    expect(out.output).toContain('cycles:');
  });
});
