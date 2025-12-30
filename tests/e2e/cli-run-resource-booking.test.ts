import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { runCli } from '../../src/cli/cli';
import { detectTools } from '../../src/tools/registry';
import { createTempDir, createOutputBuffer } from '../helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const runDescribe = process.env.AIC_REAL_TOOLS === '1' ? describe : describe.skip;

runDescribe('cli run resource booking workflow', () => {
  it('runs the spec end-to-end and writes reports', async function () {
    const tools = await detectTools(process.env);
    if (!tools.available.has('claude') || !tools.available.has('codex')) {
      throw new Error('Real claude and codex tools are required for this e2e test.');
    }
    const projectDir = await createTempDir('aic-e2e-booking-');
    const specsDir = path.join(projectDir, 'specs');
    await fs.mkdir(specsDir, { recursive: true });

    const specSource = path.join(here, '..', 'ai-code-test-spec', 'resource-booking-spec.md');
    const specContent = await fs.readFile(specSource, 'utf8');
    await fs.writeFile(path.join(specsDir, 'resource-booking-spec.md'), specContent, 'utf8');

    const toolHome = path.join(projectDir, '.ai-coord', 'tool-home');
    await fs.mkdir(toolHome, { recursive: true });
    const auth = await hasToolAuth(toolHome);
    if (!auth) {
      console.warn('Skipping resource booking e2e: real tools not authenticated.');
      return;
    }

    const out = createOutputBuffer();
    const err = createOutputBuffer();

    await runCli({
      argv: ['run', '--max-iterations', '1', '--timeout', '10', '--quiet'],
      cwd: projectDir,
      stdout: out.stream,
      stderr: err.stream,
      env: {
        ...process.env,
        AIC_TEST_MODE: '1',
        AIC_TOOL_HOME: toolHome
      }
    });
    if (err.output.trim()) {
      throw new Error(err.output.trim());
    }

    const reportsDir = path.join(projectDir, '.ai-coord', 'reports');
    const reportFiles = await fs.readdir(reportsDir);
    expect(reportFiles.length).toBeGreaterThanOrEqual(2);
    expect(reportFiles.some((file) => file.includes('-claude'))).toBe(true);
    expect(reportFiles.some((file) => file.includes('-codex'))).toBe(true);

    const entries = await fs.readdir(projectDir);
    const artifactEntries = entries.filter((entry) => !['specs', '.ai-coord'].includes(entry));
    expect(artifactEntries.length).toBeGreaterThan(0);

    const sessionsDir = path.join(projectDir, '.ai-coord', 'sessions');
    const sessionFiles = await fs.readdir(sessionsDir);
    expect(sessionFiles.length).toBeGreaterThan(0);
    const sessions = await Promise.all(
      sessionFiles.map(async (file) => {
        const content = await fs.readFile(path.join(sessionsDir, file), 'utf8');
        return JSON.parse(content) as {
          specs: Array<{ file: string; cycles: Array<{ leadExecution: { prompt: string } }> }>;
        };
      })
    );
    const session = sessions.find((candidate) => candidate.specs.some((spec) => spec.file === 'resource-booking-spec.md'));
    expect(session).toBeDefined();
    const resourceSpec = session?.specs.find((spec) => spec.file === 'resource-booking-spec.md');
    expect(resourceSpec?.cycles.length ?? 0).toBeGreaterThan(0);
    const leadExecution = resourceSpec?.cycles[0]?.leadExecution;
    expect(leadExecution).toBeDefined();
  }, 20 * 60_000);
});

async function hasToolAuth(toolHome: string): Promise<boolean> {
  const env = { ...process.env, HOME: toolHome, USERPROFILE: toolHome };
  const claude = await probeCommand('claude', ['--dangerously-skip-permissions', '-p', 'ping', '--output-format', 'json'], env);
  if (claude.authError || claude.timedOut) {
    return false;
  }
  if (claude.exitCode !== 0) {
    throw new Error(claude.output || 'Claude probe failed.');
  }

  const codex = await probeCommand('codex', ['exec', '--color', 'never', 'ping'], env);
  if (codex.authError || codex.timedOut) {
    return false;
  }
  if (codex.exitCode !== 0) {
    throw new Error(codex.output || 'Codex probe failed.');
  }
  return true;
}

async function probeCommand(command: string, args: string[], env: NodeJS.ProcessEnv) {
  try {
    const result = await execa(command, args, {
      env,
      reject: false,
      timeout: 10_000,
      stdin: 'ignore'
    });
    const output = [result.stdout, result.stderr].join('\n').trim();
    return {
      exitCode: result.exitCode,
      output,
      authError: isAuthError(output),
      timedOut: false
    };
  } catch (error) {
    const err = error as { timedOut?: boolean; stdout?: string; stderr?: string };
    const output = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
    return {
      exitCode: 1,
      output,
      authError: isAuthError(output),
      timedOut: Boolean(err.timedOut)
    };
  }
}

function isAuthError(output: string): boolean {
  const lower = output.toLowerCase();
  return lower.includes('invalid api key')
    || lower.includes('please run /login')
    || lower.includes('not logged in')
    || lower.includes('login required')
    || lower.includes('please run login');
}
