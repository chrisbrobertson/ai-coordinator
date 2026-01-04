import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { runCli } from '../../src/cli/cli';
import { createOutputBuffer, createTempDir } from '../helpers';

const specContent = `---\nspecmas: v3\nkind: FeatureSpec\nid: feat-core\nname: Core\nversion: 1.0.0\ncomplexity: EASY\nmaturity: 3\n---\n# Core`;

let runValidationOnly: ReturnType<typeof import('../../src/orchestration/run')>['runValidationOnly'];

describe('cli commands', () => {
  beforeEach(async () => {
    const mod = await import('../../src/orchestration/run');
    runValidationOnly = mod.runValidationOnly;
  });

  it('lists specs with status', async () => {
    const projectDir = await createTempDir('aic-cli-specs-');
    const specsDir = path.join(projectDir, 'specs');
    await fs.mkdir(specsDir, { recursive: true });
    await fs.writeFile(path.join(specsDir, 'feat-core.md'), specContent, 'utf8');

    const sessionId = 'session-123';
    const sessionsDir = path.join(projectDir, '.ai-coord', 'sessions');
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.writeFile(
      path.join(sessionsDir, `${sessionId}.json`),
      JSON.stringify({
        id: sessionId,
        workingDirectory: projectDir,
        specsDirectory: specsDir,
        specs: [
          {
            file: 'feat-core.md',
            path: path.join(specsDir, 'feat-core.md'),
            status: 'completed'
          }
        ],
        lead: 'claude',
        validators: ['codex'],
        config: {},
        status: 'completed',
        currentSpecIndex: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }),
      'utf8'
    );
    await fs.writeFile(path.join(projectDir, '.ai-coord', 'session'), sessionId, 'utf8');

    const stdout = createOutputBuffer();
    await runCli({
      argv: ['specs'],
      cwd: projectDir,
      stdout: stdout.stream,
      stderr: createOutputBuffer().stream,
      env: process.env
    });

    expect(stdout.output).toContain('feat-core.md');
    expect(stdout.output).toContain('completed');
  });

  it('shows status summary and history', async () => {
    const projectDir = await createTempDir('aic-cli-status-');
    const sessionsDir = path.join(projectDir, '.ai-coord', 'sessions');
    await fs.mkdir(sessionsDir, { recursive: true });
    const currentId = 'session-current';
    const previousId = 'session-prev';
    const now = new Date().toISOString();

    await fs.writeFile(
      path.join(sessionsDir, `${currentId}.json`),
      JSON.stringify({
        id: currentId,
        workingDirectory: projectDir,
        specsDirectory: path.join(projectDir, 'specs'),
        specs: [{ status: 'completed', file: 'feat-core.md', path: 'specs/feat-core.md' }],
        lead: 'claude',
        validators: ['codex'],
        config: {},
        status: 'completed',
        currentSpecIndex: 0,
        createdAt: now,
        updatedAt: now
      }),
      'utf8'
    );
    await fs.writeFile(
      path.join(sessionsDir, `${previousId}.json`),
      JSON.stringify({
        id: previousId,
        workingDirectory: projectDir,
        specsDirectory: path.join(projectDir, 'specs'),
        specs: [{ status: 'failed', file: 'feat-core.md', path: 'specs/feat-core.md' }],
        lead: 'claude',
        validators: ['codex'],
        config: {},
        status: 'partial',
        currentSpecIndex: 0,
        createdAt: now,
        updatedAt: now
      }),
      'utf8'
    );
    await fs.writeFile(path.join(projectDir, '.ai-coord', 'session'), currentId, 'utf8');

    const stdout = createOutputBuffer();
    await runCli({
      argv: ['status'],
      cwd: projectDir,
      stdout: stdout.stream,
      stderr: createOutputBuffer().stream,
      env: process.env
    });

    expect(stdout.output).toContain('Session:');
    expect(stdout.output).toContain('Working Directory:');
    expect(stdout.output).toContain('Active Spec:');
    expect(stdout.output).toContain('Previous sessions:');
    expect(stdout.output).toContain(previousId);
    expect(stdout.output).toContain('Project:');
  });

  it('shows pending specs and resume hint', async () => {
    const projectDir = await createTempDir('aic-cli-status-pending-');
    const sessionsDir = path.join(projectDir, '.ai-coord', 'sessions');
    await fs.mkdir(sessionsDir, { recursive: true });
    const currentId = 'session-pending';
    const now = new Date().toISOString();

    await fs.writeFile(
      path.join(sessionsDir, `${currentId}.json`),
      JSON.stringify({
        id: currentId,
        workingDirectory: projectDir,
        specsDirectory: path.join(projectDir, 'specs'),
        specs: [
          { status: 'in_progress', file: 'feat-core.md', path: 'specs/feat-core.md' },
          { status: 'failed', file: 'feat-next.md', path: 'specs/feat-next.md' }
        ],
        lead: 'claude',
        validators: ['codex'],
        config: {},
        status: 'partial',
        currentSpecIndex: 0,
        createdAt: now,
        updatedAt: now
      }),
      'utf8'
    );
    await fs.writeFile(path.join(projectDir, '.ai-coord', 'session'), currentId, 'utf8');

    const stdout = createOutputBuffer();
    await runCli({
      argv: ['status'],
      cwd: projectDir,
      stdout: stdout.stream,
      stderr: createOutputBuffer().stream,
      env: process.env
    });

    expect(stdout.output).toContain('Pending Specs: feat-core.md, feat-next.md');
    expect(stdout.output).toContain('Resume: aic run');
  });

  it('shows full status with --full', async () => {
    const projectDir = await createTempDir('aic-cli-status-full-');
    const sessionsDir = path.join(projectDir, '.ai-coord', 'sessions');
    await fs.mkdir(sessionsDir, { recursive: true });
    const currentId = 'session-full';
    const now = new Date().toISOString();

    await fs.writeFile(
      path.join(sessionsDir, `${currentId}.json`),
      JSON.stringify({
        id: currentId,
        workingDirectory: projectDir,
        specsDirectory: path.join(projectDir, 'specs'),
        specs: [
          { status: 'completed', file: 'feat-core.md', path: 'specs/feat-core.md', cycles: [] }
        ],
        lead: 'claude',
        validators: ['codex'],
        config: {},
        status: 'completed',
        currentSpecIndex: 0,
        createdAt: now,
        updatedAt: now
      }),
      'utf8'
    );
    await fs.writeFile(path.join(projectDir, '.ai-coord', 'session'), currentId, 'utf8');

    const stdout = createOutputBuffer();
    await runCli({
      argv: ['status', '--full'],
      cwd: projectDir,
      stdout: stdout.stream,
      stderr: createOutputBuffer().stream,
      env: process.env
    });

    expect(stdout.output).toContain('Specs:');
    expect(stdout.output).toContain('Working Directory:');
    expect(stdout.output).toContain('Active Spec:');
    expect(stdout.output).toContain('feat-core.md');
  });

  it('reads and writes global config', async () => {
    const projectDir = await createTempDir('aic-cli-config-');
    const stateDir = await createTempDir('aic-state-');
    const stdout = createOutputBuffer();
    const stderr = createOutputBuffer();

    await runCli({
      argv: ['config'],
      cwd: projectDir,
      stdout: stdout.stream,
      stderr: stderr.stream,
      env: { ...process.env, AIC_STATE_DIR: stateDir }
    });
    expect(stdout.output).toContain('{');

    const setOut = createOutputBuffer();
    await runCli({
      argv: ['config', 'defaultMaxIterations=7'],
      cwd: projectDir,
      stdout: setOut.stream,
      stderr: stderr.stream,
      env: { ...process.env, AIC_STATE_DIR: stateDir }
    });
    expect(setOut.output).toContain('Updated config');

    const verifyOut = createOutputBuffer();
    await runCli({
      argv: ['config'],
      cwd: projectDir,
      stdout: verifyOut.stream,
      stderr: stderr.stream,
      env: { ...process.env, AIC_STATE_DIR: stateDir }
    });
    expect(verifyOut.output).toContain('defaultMaxIterations');
    expect(verifyOut.output).toContain('7');
  });

  it('cleans sessions and logs', async () => {
    const projectDir = await createTempDir('aic-cli-clean-');
    const sessionsDir = path.join(projectDir, '.ai-coord', 'sessions');
    const logsDir = path.join(projectDir, '.ai-coord', 'logs');
    await fs.mkdir(sessionsDir, { recursive: true });
    await fs.mkdir(logsDir, { recursive: true });

    const oldFile = path.join(sessionsDir, 'old.json');
    await fs.writeFile(oldFile, '{}', 'utf8');
    const oldTime = Date.now() - 40 * 24 * 60 * 60 * 1000;
    await fs.utimes(oldFile, oldTime / 1000, oldTime / 1000);

    const stdout = createOutputBuffer();
    await runCli({
      argv: ['clean'],
      cwd: projectDir,
      stdout: stdout.stream,
      stderr: createOutputBuffer().stream,
      env: process.env
    });

    expect(stdout.output).toContain('Cleaned sessions');
    await expect(fs.access(path.join(projectDir, '.ai-coord'))).rejects.toBeDefined();
  });

  it('invokes validate command', async () => {
    const projectDir = await createTempDir('aic-cli-validate-');
    const specsDir = path.join(projectDir, 'specs');
    await fs.mkdir(specsDir, { recursive: true });
    await fs.writeFile(path.join(specsDir, 'feat-core.md'), specContent, 'utf8');

    const stdout = createOutputBuffer();
    await runValidationOnly({
      specs: undefined,
      exclude: undefined,
      timeout: 1,
      verbose: false,
      heartbeat: 0,
      quiet: true
    }, {
      cwd: projectDir,
      output: stdout.stream,
      errorOutput: createOutputBuffer().stream,
      env: process.env
    }, {
      runner: {
        async runLead() {
          return { output: 'n/a', exitCode: 0, durationMs: 0, streamed: false };
        },
        async runValidator() {
          return {
          output: JSON.stringify({
            response_block: {
              completeness: 100,
              status: 'PASS',
              findings: [],
              recommendations: ['None']
            }
          }),
            exitCode: 0,
            durationMs: 5,
            streamed: false
          };
        }
      }
    });

    expect(stdout.output).toContain('Specs to build');
  });
});
