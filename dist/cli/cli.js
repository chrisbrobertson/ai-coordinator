import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import path from 'node:path';
import fs from 'node:fs/promises';
import { detectTools } from '../tools/registry.js';
import { runCoordinator } from '../orchestration/run.js';
import { loadSpecs, orderSpecs } from '../specs/discovery.js';
import { PROJECT_LINK_FILE, SPECS_DIR, getLogsDir, getReportsDir, getSessionsDir } from '../config/paths.js';
import { loadSession } from '../orchestration/session.js';
import { readGlobalConfig, writeGlobalConfig } from '../config/global-config.js';
import { ensureDir, pathExists, removePath } from '../utils/fs.js';
export async function runCli(options) {
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
    async function handleRun(cmd) {
        const context = {
            cwd,
            output: stdout,
            errorOutput: stderr,
            env
        };
        try {
            await runCoordinator(cmd, context);
        }
        catch (error) {
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
        .option('--resume', 'Resume last session')
        .option('--stop-on-failure', 'Stop on first spec failure')
        .option('--lead-permissions <list>', 'Override lead permissions')
        .option('--sandbox', 'Run in sandbox')
        .option('--interactive', 'Interactive mode')
        .option('--verbose', 'Verbose output')
        .option('--quiet', 'Quiet output')
        .option('--dry-run', 'List specs and exit')
        .action(handleRun);
    program.command('tools')
        .description('List available AI tools')
        .action(async () => {
        const registry = await detectTools(env);
        const table = new Table({ head: ['Tool', 'Version', 'Status'] });
        if (registry.available.size === 0) {
            table.push(['-', '-', 'No tools found']);
        }
        else {
            for (const tool of registry.available.values()) {
                table.push([tool.name, tool.version, '✓ Ready']);
            }
        }
        stdout.write(`${table.toString()}\n`);
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
        ordered.forEach((spec) => {
            stdout.write(`${spec.file} (${spec.meta.complexity}, Level ${spec.meta.maturity})\n`);
        });
    });
    program.command('status')
        .description('Show current session status for this directory')
        .action(async () => {
        const session = await loadSession(cwd, env);
        if (!session) {
            stdout.write('No session found.\n');
            return;
        }
        stdout.write(`Session ${session.id}: ${session.status}\n`);
    });
    program.command('config [pair]')
        .description('View or set global configuration')
        .action(async (pair) => {
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
        config[key] = storedValue;
        await writeGlobalConfig(config, env);
        stdout.write('Updated config.\n');
    });
    program.command('clean')
        .description('Remove old sessions and logs')
        .action(async () => {
        const sessionsDir = getSessionsDir(env);
        const reportsDir = getReportsDir(env);
        const logsDir = getLogsDir(env);
        const threshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const removed = await removeOldFiles([sessionsDir, reportsDir, logsDir], threshold);
        const linkPath = path.join(cwd, PROJECT_LINK_FILE);
        if (await pathExists(linkPath)) {
            await fs.rm(linkPath, { force: true });
        }
        if (removed === 0) {
            stdout.write('No sessions to clean.\n');
            return;
        }
        stdout.write('Cleaned sessions.\n');
    });
    await program.parseAsync(options.argv, { from: 'user' });
}
export function createProgram() {
    const program = new Command();
    program
        .name('aic')
        .description('AI Spec Coordinator')
        .version('1.0.0');
    return program;
}
async function removeOldFiles(dirs, threshold) {
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
