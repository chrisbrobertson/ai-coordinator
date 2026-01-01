import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import path from 'node:path';
import fs from 'node:fs/promises';
import { detectTools } from '../tools/registry.js';
import { TOOL_DEFINITIONS } from '../tools/tool-definitions.js';
import { runCoordinator, runValidationOnly } from '../orchestration/run.js';
import { loadSpecs, orderSpecs } from '../specs/discovery.js';
import { RunContext, RunOptions, Session } from '../types.js';
import { PROJECT_SESSION_FILE, SPECS_DIR, getProjectLogsDir, getProjectReportsDir, getProjectSessionsDir, getProjectStateDir } from '../config/paths.js';
import { loadSession } from '../orchestration/session.js';
import { readGlobalConfig, writeGlobalConfig } from '../config/global-config.js';
import { ensureDir, pathExists, removePath } from '../utils/fs.js';

export interface CliRunOptions {
  argv: string[];
  cwd?: string;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  env?: NodeJS.ProcessEnv;
}

export async function runCli(options: CliRunOptions): Promise<void> {
  const program = createProgram();
  const cwd = options.cwd ?? process.cwd();
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const env = options.env ?? process.env;

  program.configureOutput({
    writeOut: (str) => stdout.write(str),
    writeErr: (str) => stderr.write(str)
  });

  program.hook('preAction', (command) => {
    if (command.parent) {
      command.parent.configureHelp({ sortSubcommands: true });
    }
  });

  async function handleRun(cmd: RunOptions) {
    const context: RunContext = {
      cwd,
      output: stdout,
      errorOutput: stderr,
      env
    };
    try {
      await runCoordinator(cmd, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stderr.write(chalk.red(`${message}\n`));
      process.exitCode = 1;
    }
  }

  program.command('run')
    .description('Build specs in the current directory')
    .option('--specs <files>', 'Comma-separated list or glob of specs to include')
    .option('--exclude <files>', 'Comma-separated list or glob of specs to exclude')
    .option('--lead <tool>', 'Force lead tool (claude|codex|gemini)')
    .option('--validators <tools>', 'Comma-separated list of validator tools')
    .option('--max-iterations <n>', 'Max cycles per spec', Number, 5)
    .option('--timeout <minutes>', 'Per-cycle timeout in minutes', Number, 10)
    .option('--preflight-threshold <n>', 'Preflight completeness threshold (0-100)', Number, 70)
    .option('--preflight-iterations <n>', 'Max validation cycles in preflight mode', Number, 2)
    .option('--resume', 'Resume last session')
    .option('--stop-on-failure', 'Stop on first spec failure')
    .option('--lead-permissions <list>', 'Override lead permissions')
    .option('--sandbox', 'Run in sandbox')
    .option('--interactive', 'Interactive mode')
    .option('--verbose', 'Verbose output')
    .option('--heartbeat <seconds>', 'Verbose heartbeat interval in seconds (0 to disable)', Number, 0)
    .option('--quiet', 'Quiet output')
    .option('--dry-run', 'List specs and exit')
    .option('--start-over', 'Ignore previous session state and start fresh')
    .option('--no-preflight', 'Disable preflight validation on existing code')
    .action(handleRun);

  program.command('tools')
    .description('List available AI tools')
    .action(async () => {
      const registry = await detectTools(env);
      const table = new Table({ head: ['Tool', 'Version', 'Status'] });
      for (const definition of TOOL_DEFINITIONS) {
        const tool = registry.available.get(definition.name);
        if (tool) {
          table.push([tool.name, tool.version, '✓ Ready']);
        } else {
          table.push([definition.name, '-', '✗ Not found']);
        }
      }
      stdout.write(`${table.toString()}\n`);
    });

  program.command('validate')
    .description('Validate specs without running the lead tool')
    .option('--specs <files>', 'Comma-separated list or glob of specs to include')
    .option('--exclude <files>', 'Comma-separated list or glob of specs to exclude')
    .option('--timeout <minutes>', 'Per-cycle timeout in minutes', Number, 10)
    .option('--verbose', 'Verbose output')
    .option('--heartbeat <seconds>', 'Verbose heartbeat interval in seconds (0 to disable)', Number, 0)
    .option('--quiet', 'Quiet output')
    .action(async (cmd) => {
      const context: RunContext = {
        cwd,
        output: stdout,
        errorOutput: stderr,
        env
      };
      try {
        await runValidationOnly(cmd, context);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stderr.write(chalk.red(`${message}\n`));
        process.exitCode = 1;
      }
    });

  program.command('init')
    .description('Initialize a new project with specs directory')
    .option('--force', 'Overwrite specs directory if it exists')
    .action(async (cmd) => {
      const specsDir = path.join(cwd, SPECS_DIR);
      if (await pathExists(specsDir)) {
        if (!cmd.force) {
          stderr.write('specs/ already exists\n');
          process.exitCode = 1;
          return;
        }
        await removePath(specsDir);
      }
      await ensureDir(specsDir);
      const example = `---\nspecmas: v3\nkind: FeatureSpec\nid: example-feature\nname: Example Feature\nversion: 1.0.0\ncomplexity: EASY\nmaturity: 3\n---\n\n# Example Feature\n\nDescribe your feature here.`;
      await fs.writeFile(path.join(specsDir, 'example-feature.md'), example, 'utf8');
      stdout.write('✓ Initialized ai-spec-coordinator\n');
    });

  program.command('specs')
    .description('List specs in the specs directory')
    .action(async () => {
      const specsDir = path.join(cwd, SPECS_DIR);
      const loaded = await loadSpecs(specsDir);
      const ordered = orderSpecs(loaded.map((spec) => spec.entry));
      if (ordered.length === 0) {
        stdout.write('No specs found.\n');
        return;
      }
      const session = await loadSession(cwd, env);
      const statusByPath = new Map<string, string>();
      if (session) {
        for (const spec of session.specs) {
          statusByPath.set(spec.path, spec.status);
        }
      }
      ordered.forEach((spec) => {
        const status = statusByPath.get(spec.path);
        const suffix = status ? ` - ${status}` : '';
        stdout.write(`${spec.file} (${spec.meta.complexity}, Level ${spec.meta.maturity})${suffix}\n`);
      });
    });

  program.command('status')
    .description('Show current session status for this directory')
    .option('--full', 'Show full session details')
    .action(async (cmd) => {
      const session = await loadSession(cwd, env);
      const sessionsDir = getProjectSessionsDir(cwd);
      if (!session && !(await pathExists(sessionsDir))) {
        stdout.write('No session found.\n');
        return;
      }
      if (session) {
        if (cmd.full) {
          stdout.write(formatSessionStatus(session));
        } else {
          stdout.write(formatSessionSummary(session));
        }
      }
      const history = await loadSessionHistory(cwd, session?.id);
      if (history.length > 0) {
        stdout.write('Previous sessions:\n');
        history.forEach((entry) => {
          stdout.write(`- ${entry.id}: ${entry.status} (${entry.updatedAt}) - ${entry.specsSummary}\n`);
          stdout.write(`  Project: ${entry.workingDirectory}\n`);
          stdout.write(`  Active Spec: ${entry.activeSpec}\n`);
        });
      }
    });

  program.command('config [pair]')
    .description('View or set global configuration')
    .action(async (pair?: string) => {
      if (!pair) {
        const config = await readGlobalConfig(env);
        stdout.write(`${JSON.stringify(config, null, 2)}\n`);
        return;
      }
      const [key, value] = pair.split('=');
      if (!key || value === undefined) {
        stderr.write('Invalid format. Use key=value.\n');
        process.exitCode = 1;
        return;
      }
      const config = await readGlobalConfig(env);
      const numericValue = Number(value);
      const storedValue = Number.isNaN(numericValue) ? value : numericValue;
      config[key as keyof typeof config] = storedValue as never;
      await writeGlobalConfig(config, env);
      stdout.write('Updated config.\n');
    });

  program.command('clean')
    .description('Remove old sessions and logs')
    .action(async () => {
      const reportsDir = getProjectReportsDir(cwd);
      const logsDir = getProjectLogsDir(cwd);
      const sessionsDir = getProjectSessionsDir(cwd);
      const threshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const removed = await removeOldFiles([sessionsDir, reportsDir, logsDir], threshold);
      const projectDir = getProjectStateDir(cwd);
      if (await pathExists(projectDir)) {
        await fs.rm(projectDir, { recursive: true, force: true });
      }
      if (removed === 0) {
        stdout.write('No sessions to clean.\n');
        return;
      }
      stdout.write('Cleaned sessions.\n');
    });

  await program.parseAsync(options.argv, { from: 'user' });
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name('aic')
    .description('AI Spec Coordinator')
    .version('0.9.0');
  return program;
}

function formatSessionStatus(session: Session): string {
  const activeSpec = session.specs.find((spec) => spec.status === 'in_progress')?.file ?? 'None';
  const lines = [
    `Session: ${session.id}`,
    `Status: ${session.status}`,
    `Working Directory: ${session.workingDirectory}`,
    `Active Spec: ${activeSpec}`,
    `Lead: ${session.lead}`,
    `Validators: ${session.validators.join(', ')}`,
    ''
  ];
  lines.push('Specs:');
  session.specs.forEach((spec, index) => {
    const cycles = spec.cycles.length;
    const lastCycle = cycles > 0 ? spec.cycles[cycles - 1] : undefined;
    const completeness = lastCycle
      ? Math.round(
        lastCycle.validations.reduce((sum, validation) => sum + validation.parsed.completeness, 0) / Math.max(lastCycle.validations.length, 1)
      )
      : 0;
    lines.push(
      `${index + 1}. ${spec.file} - ${spec.status} (cycles: ${cycles}, completeness: ${completeness}%)`
    );
    if (spec.lastError) {
      lines.push(`   Last error: ${spec.lastError}`);
    }
  });
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function formatSessionSummary(session: Session): string {
  const total = session.specs.length;
  const completed = session.specs.filter((spec) => spec.status === 'completed').length;
  const failed = session.specs.filter((spec) => spec.status === 'failed').length;
  const inProgress = session.specs.filter((spec) => spec.status === 'in_progress').length;
  const pendingSpecs = session.specs
    .filter((spec) => spec.status !== 'completed' && spec.status !== 'skipped')
    .map((spec) => spec.file);
  const activeSpec = session.specs.find((spec) => spec.status === 'in_progress')?.file ?? 'None';
  const lastError = session.specs.find((spec) => spec.lastError)?.lastError;
  const lines = [
    `Session: ${session.id}`,
    `Status: ${session.status}`,
    `Working Directory: ${session.workingDirectory}`,
    `Active Spec: ${activeSpec}`,
    `Lead: ${session.lead}`,
    `Validators: ${session.validators.join(', ')}`,
    `Specs: ${completed}/${total} completed, ${failed} failed, ${inProgress} in progress`,
    ''
  ];
  if (lastError) {
    lines.splice(6, 0, `Last Error: ${lastError}`);
  }
  if (pendingSpecs.length > 0) {
    lines.push(`Pending Specs: ${pendingSpecs.join(', ')}`);
    lines.push('');
  }
  if (session.status !== 'completed') {
    lines.push('Resume: aic run (or start over with --start-over)');
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

async function removeOldFiles(dirs: string[], threshold: number): Promise<number> {
  let removed = 0;
  for (const dir of dirs) {
    if (!(await pathExists(dir))) {
      continue;
    }
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const filePath = path.join(dir, entry.name);
      const stat = await fs.stat(filePath);
      if (stat.mtimeMs < threshold) {
        await fs.rm(filePath, { force: true });
        removed += 1;
      }
    }
  }
  return removed;
}

async function loadSessionHistory(
  cwd: string,
  excludeId?: string
): Promise<Array<{
  id: string;
  status: string;
  updatedAt: string;
  specsSummary: string;
  workingDirectory: string;
  activeSpec: string;
}>> {
  const sessionsDir = getProjectSessionsDir(cwd);
  if (!(await pathExists(sessionsDir))) {
    return [];
  }
  const entries = await fs.readdir(sessionsDir, { withFileTypes: true });
  const sessions: Array<{
    id: string;
    status: string;
    updatedAt: string;
    specsSummary: string;
    workingDirectory: string;
    activeSpec: string;
  }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }
    const sessionId = entry.name.replace(/\\.json$/, '');
    if (excludeId && sessionId === excludeId) {
      continue;
    }
    const content = await fs.readFile(path.join(sessionsDir, entry.name), 'utf8');
    const parsed = JSON.parse(content) as {
      id: string;
      status: string;
      updatedAt: string;
      workingDirectory?: string;
      specs: Array<{ status: string; file?: string }>;
    };
    const total = parsed.specs?.length ?? 0;
    const completed = parsed.specs?.filter((spec) => spec.status === 'completed').length ?? 0;
    const failed = parsed.specs?.filter((spec) => spec.status === 'failed').length ?? 0;
    const inProgress = parsed.specs?.filter((spec) => spec.status === 'in_progress').length ?? 0;
    const specsSummary = `${completed}/${total} completed, ${failed} failed, ${inProgress} in progress`;
    const activeSpec = parsed.specs?.find((spec) => spec.status === 'in_progress')?.file ?? 'None';
    sessions.push({
      id: parsed.id,
      status: parsed.status,
      updatedAt: parsed.updatedAt,
      specsSummary,
      workingDirectory: parsed.workingDirectory ?? cwd,
      activeSpec
    });
  }
  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return sessions;
}
