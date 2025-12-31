import path from 'node:path';
import fs from 'node:fs/promises';
import chalk from 'chalk';
import readline from 'node:readline/promises';
import ora from 'ora';
import { execa } from 'execa';
import { DefaultToolRunner } from '../tools/runner.js';
import { assignRoles } from '../tools/roles.js';
import { detectTools } from '../tools/registry.js';
import { loadSpecs, orderSpecs } from '../specs/discovery.js';
import { createSession, persistSession, completeSession, loadSession } from './session.js';
import { getProjectLogsDir, getProjectReportsDir, getProjectSessionsDir, PROJECT_SESSION_FILE, SPECS_DIR } from '../config/paths.js';
import { ensureDir, listFilesRecursive, pathExists, writeTextFile } from '../utils/fs.js';
import { createLogger } from '../utils/logger.js';
export async function runCoordinator(options, context, deps = {}) {
    const cwd = context.cwd;
    const output = context.output;
    const errorOutput = context.errorOutput;
    const spinner = ora({ isEnabled: false });
    await autoCleanState(cwd);
    if (options.sandbox) {
        await ensureSandboxAvailable();
    }
    spinner.start('Detecting tools');
    const registry = await detectTools(context.env);
    spinner.stop();
    const availableTools = [...registry.available.keys()];
    if (availableTools.length === 0) {
        throw new Error('No AI tools found. Install at least one: claude, codex, or gemini');
    }
    const requestedValidators = options.validators
        ? options.validators.split(',').map((value) => value.trim()).filter(Boolean)
        : undefined;
    const roleAssignment = assignRoles(availableTools, options.lead, requestedValidators);
    const specsDir = path.join(cwd, SPECS_DIR);
    const includeSpecs = options.specs ? options.specs.split(',').map((value) => value.trim()).filter(Boolean) : undefined;
    const excludeSpecs = options.exclude ? options.exclude.split(',').map((value) => value.trim()).filter(Boolean) : undefined;
    spinner.start('Loading specs');
    const loadedSpecs = await loadSpecs(specsDir, { include: includeSpecs, exclude: excludeSpecs });
    spinner.stop();
    if (loadedSpecs.length === 0) {
        throw new Error('No specs found in ./specs/');
    }
    const entries = orderSpecs(loadedSpecs.map((spec) => spec.entry));
    const orderedLoaded = entries.map((entry) => loadedSpecs.find((spec) => spec.entry.path === entry.path)).filter(Boolean);
    if (options.dryRun) {
        output.write(formatDryRun(entries, roleAssignment.lead, roleAssignment.validators));
        return;
    }
    const lowMaturity = entries.filter((spec) => spec.meta.maturity < 3);
    const testMode = context.env.AIC_TEST_MODE === '1';
    if (lowMaturity.length > 0 && !options.quiet) {
        for (const spec of lowMaturity) {
            output.write(chalk.yellow(`Spec ${spec.file} maturity ${spec.meta.maturity} is below recommended minimum (3).\\n`));
        }
        const proceed = testMode ? true : await confirmProceed();
        if (!proceed) {
            throw new Error('Aborted due to low spec maturity.');
        }
    }
    let session = null;
    if (options.resume) {
        session = await loadSession(cwd, context.env);
        if (!session) {
            throw new Error('No session to resume');
        }
    }
    else {
        const priorSession = await loadSession(cwd, context.env);
        if (priorSession && needsResume(priorSession)) {
            if (options.startOver) {
                await fs.rm(path.join(cwd, PROJECT_SESSION_FILE), { force: true });
            }
            else {
                const shouldResume = testMode ? true : await confirmResume();
                if (shouldResume) {
                    session = priorSession;
                }
                else {
                    await fs.rm(path.join(cwd, PROJECT_SESSION_FILE), { force: true });
                }
            }
        }
    }
    if (!session) {
        const completedSpecs = await loadCompletedSpecKeys(cwd);
        session = await createSession({
            cwd,
            specs: entries,
            lead: roleAssignment.lead,
            validators: roleAssignment.validators,
            config: {
                maxIterations: options.maxIterations,
                timeoutPerCycle: options.timeout,
                leadPermissions: options.leadPermissions ? options.leadPermissions.split(',') : undefined,
                sandbox: options.sandbox,
                stopOnFailure: options.stopOnFailure,
                verbose: options.verbose,
                quiet: options.quiet,
                preflight: options.preflight,
                preflightThreshold: options.preflightThreshold,
                preflightIterations: options.preflightIterations
            },
            env: context.env
        });
    }
    output.write(formatStartSummary({
        cwd,
        specsDir,
        specs: entries,
        lead: roleAssignment.lead,
        validators: roleAssignment.validators,
        isResume: options.resume
    }));
    if (!options.quiet) {
        await startCountdown(output);
    }
    const logger = await createLogger(session.id, cwd);
    logger.info({ sessionId: session.id }, 'Session started');
    let activeProcess = null;
    let heartbeatTimer = null;
    const heartbeatSeconds = Math.max(0, Number.isFinite(options.heartbeat) ? options.heartbeat : 0);
    const runner = deps.runner ?? new DefaultToolRunner({
        interactive: options.interactive,
        leadPermissions: session.config.leadPermissions,
        sandbox: options.sandbox,
        sandboxImage: context.env.AIC_SANDBOX_IMAGE ?? 'node:20',
        verbose: options.verbose,
        output,
        inheritStdin: options.interactive && process.stdin.isTTY,
        env: context.env,
        onSpawn: (info) => {
            activeProcess = info.child;
            if (options.verbose) {
                const pid = info.child.pid ?? 'unknown';
                output.write(`[process] pid=${pid} cmd=${info.command} ${info.args.join(' ')}\n`);
                if (heartbeatTimer) {
                    clearInterval(heartbeatTimer);
                }
                if (heartbeatSeconds > 0) {
                    heartbeatTimer = setInterval(() => {
                        output.write(`[heartbeat] pid=${pid} running\n`);
                    }, heartbeatSeconds * 1000);
                }
            }
        },
        onWarning: (message) => output.write(chalk.yellow(`${message}\\n`))
    });
    const contextDocs = orderedLoaded.filter((spec) => spec.entry.contextOnly).map((spec) => spec.content);
    await ensureDir(getProjectReportsDir(cwd));
    let interrupted = false;
    let exitTimer = null;
    const handleSigint = () => {
        if (interrupted) {
            return;
        }
        interrupted = true;
        errorOutput.write('\\nInterrupted. Saving session state...\\n');
        if (activeProcess) {
            const proc = activeProcess;
            proc.kill('SIGTERM');
            setTimeout(() => {
                if (!proc.killed) {
                    proc.kill('SIGKILL');
                }
            }, 2000);
        }
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
        exitTimer = setTimeout(() => {
            process.exitCode = 130;
            process.exit(130);
        }, 5000);
    };
    const handleStdin = (chunk) => {
        if (chunk.includes(3)) {
            handleSigint();
        }
    };
    if (process.stdin.readable) {
        process.stdin.on('data', handleStdin);
    }
    process.on('SIGINT', handleSigint);
    process.on('SIGTERM', handleSigint);
    const completedSpecs = options.resume ? new Set() : await loadCompletedSpecKeys(cwd);
    const hasCodeArtifacts = await hasImplementationArtifacts(cwd);
    for (let i = session.currentSpecIndex; i < session.specs.length; i += 1) {
        const specEntry = session.specs[i];
        session.currentSpecIndex = i;
        if (specEntry.contextOnly) {
            specEntry.status = 'skipped';
            await persistSession(session, context.env);
            continue;
        }
        const specContent = orderedLoaded.find((spec) => spec.entry.path === specEntry.path)?.content ?? '';
        const iterations = session.config.maxIterations;
        specEntry.status = 'in_progress';
        specEntry.startedAt = new Date().toISOString();
        await persistSession(session, context.env);
        let validationFeedback = '';
        let validateOnly = false;
        let validationIterations = iterations;
        const wasCompleted = completedSpecs.has(specEntry.meta.id) || completedSpecs.has(specEntry.file);
        if (options.preflight && (hasCodeArtifacts || wasCompleted)) {
            if (!options.quiet) {
                output.write(`Preflight validation for ${specEntry.file}...\n`);
            }
            const validationPrompt = await buildValidationPrompt(specContent, contextDocs, cwd, specEntry.file);
            const validations = await runValidationPass({
                cycleNumber: 0,
                specEntry,
                session,
                validationPrompt,
                roleAssignment,
                runner,
                cwd,
                timeoutMs: options.timeout * 60_000,
                output,
                options,
                onProcessComplete: () => {
                    activeProcess = null;
                    if (heartbeatTimer) {
                        clearInterval(heartbeatTimer);
                        heartbeatTimer = null;
                    }
                }
            });
            const consensus = hasConsensus(validations.map((validation) => validation.parsed));
            const avgCompleteness = Math.round(validations.reduce((sum, validation) => sum + validation.parsed.completeness, 0) / Math.max(validations.length, 1));
            if (consensus || avgCompleteness >= options.preflightThreshold) {
                validateOnly = true;
                validationIterations = Math.min(options.preflightIterations, iterations);
                if (consensus) {
                    specEntry.status = 'completed';
                    specEntry.completedAt = new Date().toISOString();
                    await persistSession(session, context.env);
                    output.write(chalk.green(`Consensus reached for ${specEntry.file}.\n`));
                    continue;
                }
                validationFeedback = buildValidationFeedback(validations);
            }
        }
        for (let cycleNumber = 1; cycleNumber <= validationIterations; cycleNumber += 1) {
            const cycleStart = new Date().toISOString();
            const previousReports = await getPreviousReportFiles(cwd, session.id, specEntry.meta.id, cycleNumber - 1, roleAssignment.validators);
            const historicalReports = await getRecentReportSummaries(cwd, specEntry.meta.id, 6);
            let leadResult = {
                output: 'Lead skipped: validation-only mode.',
                exitCode: 0,
                durationMs: 0,
                streamed: false
            };
            let leadPrompt = '';
            if (!validateOnly) {
                leadPrompt = buildLeadPrompt(specContent, contextDocs, validationFeedback, await summarizeCodebase(cwd), specEntry.file, previousReports, historicalReports);
                spinner.start(`Cycle ${cycleNumber}/${validationIterations}: Lead implementing ${specEntry.file}`);
                if (options.verbose) {
                    output.write(`[lead:${roleAssignment.lead}] starting\n`);
                }
                leadResult = await runLeadWithRetry(runner, roleAssignment.lead, leadPrompt, cwd, options.timeout * 60_000);
                spinner.stop();
                activeProcess = null;
                if (heartbeatTimer) {
                    clearInterval(heartbeatTimer);
                    heartbeatTimer = null;
                }
                if (options.verbose && !leadResult.streamed && leadResult.output) {
                    output.write(`${leadResult.output}\n`);
                }
                const leadReportPath = buildLeadReportPath(cwd, session.id, specEntry.meta.id, cycleNumber, roleAssignment.lead);
                if (!leadResult.output || leadResult.output.trim().length === 0) {
                    const durationSeconds = Math.max(1, Math.round(leadResult.durationMs / 1000));
                    const leadFailureMessage = [
                        `Lead tool ${roleAssignment.lead} returned no output.`,
                        `Exit code: ${leadResult.exitCode}. Duration: ${durationSeconds}s.`,
                        'Possible causes: system sleep, tool timeout, authentication failure, or network interruption.',
                        `Check logs: ${path.join('.ai-coord', 'logs', `${session.id}.log`)}`
                    ].join(' ');
                    specEntry.status = 'failed';
                    specEntry.completedAt = new Date().toISOString();
                    specEntry.lastError = leadFailureMessage;
                    session.status = 'partial';
                    await writeTextFile(leadReportPath, leadFailureMessage);
                    await persistSession(session, context.env);
                    await generateReport(session, context.env);
                    logger.error({ cycle: cycleNumber, tool: roleAssignment.lead, exitCode: leadResult.exitCode, durationMs: leadResult.durationMs }, leadFailureMessage);
                    process.off('SIGINT', handleSigint);
                    process.off('SIGTERM', handleSigint);
                    if (process.stdin.readable) {
                        process.stdin.off('data', handleStdin);
                        process.stdin.pause();
                    }
                    if (heartbeatTimer) {
                        clearInterval(heartbeatTimer);
                        heartbeatTimer = null;
                    }
                    if (exitTimer) {
                        clearTimeout(exitTimer);
                        exitTimer = null;
                    }
                    throw new Error(leadFailureMessage);
                }
                await writeTextFile(leadReportPath, leadResult.output || 'No output captured.');
                if (options.verbose) {
                    output.write(`[report] ${leadReportPath}\n`);
                }
            }
            if (interrupted) {
                await persistSession(session, context.env);
                process.off('SIGINT', handleSigint);
                process.off('SIGTERM', handleSigint);
                if (process.stdin.readable) {
                    process.stdin.off('data', handleStdin);
                    process.stdin.pause();
                }
                if (heartbeatTimer) {
                    clearInterval(heartbeatTimer);
                    heartbeatTimer = null;
                }
                if (exitTimer) {
                    clearTimeout(exitTimer);
                    exitTimer = null;
                }
                if (interrupted && process.env.AIC_NO_EXIT !== '1') {
                    process.exitCode = 130;
                    process.exit(130);
                }
                return;
            }
            logger.info({ cycle: cycleNumber, tool: roleAssignment.lead }, 'Lead execution completed');
            if (options.verbose) {
                logger.info({ cycle: cycleNumber, tool: roleAssignment.lead, output: leadResult.output }, 'Lead output');
            }
            const validationPrompt = await buildValidationPrompt(specContent, contextDocs, cwd, specEntry.file);
            const validations = await runValidationPass({
                cycleNumber,
                specEntry,
                session,
                validationPrompt,
                roleAssignment,
                runner,
                cwd,
                timeoutMs: options.timeout * 60_000,
                output,
                options,
                onProcessComplete: () => {
                    activeProcess = null;
                    if (heartbeatTimer) {
                        clearInterval(heartbeatTimer);
                        heartbeatTimer = null;
                    }
                }
            });
            if (options.verbose) {
                validations.forEach((validation) => {
                    logger.info({ cycle: cycleNumber, tool: validation.tool, output: validation.output }, 'Validator output');
                });
            }
            const consensusReached = hasConsensus(validations.map((validation) => validation.parsed));
            if (!consensusReached) {
                validationFeedback = buildValidationFeedback(validations);
            }
            specEntry.cycles.push({
                number: cycleNumber,
                specId: specEntry.meta.id,
                startedAt: cycleStart,
                completedAt: new Date().toISOString(),
                leadExecution: {
                    tool: roleAssignment.lead,
                    prompt: leadPrompt,
                    output: leadResult.output,
                    filesModified: [],
                    durationMs: leadResult.durationMs,
                    exitCode: leadResult.exitCode
                },
                validations,
                consensusReached
            });
            await persistSession(session, context.env);
            if (interrupted) {
                process.off('SIGINT', handleSigint);
                process.off('SIGTERM', handleSigint);
                if (process.stdin.readable) {
                    process.stdin.off('data', handleStdin);
                    process.stdin.pause();
                }
                if (heartbeatTimer) {
                    clearInterval(heartbeatTimer);
                    heartbeatTimer = null;
                }
                if (exitTimer) {
                    clearTimeout(exitTimer);
                    exitTimer = null;
                }
                if (interrupted && process.env.AIC_NO_EXIT !== '1') {
                    process.exitCode = 130;
                    process.exit(130);
                }
                return;
            }
            if (consensusReached) {
                output.write(chalk.green(`Consensus reached for ${specEntry.file}.\n`));
                specEntry.status = 'completed';
                specEntry.completedAt = new Date().toISOString();
                await persistSession(session, context.env);
                break;
            }
            if (cycleNumber === validationIterations) {
                specEntry.status = 'failed';
                output.write(chalk.yellow(`Max iterations reached for ${specEntry.file}.\n`));
                if (session.config.stopOnFailure) {
                    session.status = 'partial';
                    await persistSession(session, context.env);
                    await generateReport(session, context.env);
                    return;
                }
            }
            else {
                output.write(`Cycle ${cycleNumber}/${iterations}: Lead completed, awaiting validation...\n`);
            }
        }
    }
    session.status = session.specs.every((spec) => spec.status === 'completed' || spec.status === 'skipped')
        ? 'completed'
        : 'partial';
    await persistSession(session, context.env);
    await generateReport(session, context.env);
    if (session.status === 'completed') {
        await completeSession(session, context.env);
    }
    process.off('SIGINT', handleSigint);
    process.off('SIGTERM', handleSigint);
    if (process.stdin.readable) {
        process.stdin.off('data', handleStdin);
        process.stdin.pause();
    }
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
    if (exitTimer) {
        clearTimeout(exitTimer);
        exitTimer = null;
    }
    if (interrupted && process.env.AIC_NO_EXIT !== '1') {
        process.exitCode = 130;
        process.exit(130);
    }
}
function formatDryRun(specs, lead, validators) {
    const lines = ['Specs to build:'];
    specs.forEach((spec, index) => {
        lines.push(`${index + 1}. ${spec.file} (${spec.meta.complexity}, Level ${spec.meta.maturity})`);
    });
    lines.push('');
    lines.push(`Lead: ${lead}`);
    lines.push(`Validators: ${validators.join(', ')}`);
    lines.push('');
    return lines.join('\n');
}
async function summarizeCodebase(cwd) {
    const files = await listFilesRecursive(cwd, {
        excludeDirs: ['node_modules', 'dist', '.git', '.ai-coord'],
        limit: 50
    });
    const relative = files.map((file) => path.relative(cwd, file));
    return relative.join('\n');
}
function buildLeadPrompt(specContent, contextDocs, validationFeedback, codebaseSummary, specFile, reportFiles, reportSummaries) {
    const contextHint = contextDocs.length > 0
        ? 'System/architecture specs are present in the specs directory and should be used for context.'
        : 'Use any relevant supporting specs in the specs directory for context.';
    const reportSection = reportFiles.length > 0
        ? `\n\nPrevious validation reports:\n${reportFiles.map((file) => `- ${file}`).join('\n')}`
        : '';
    const reportContentSection = reportSummaries
        ? `\n\nPREVIOUS REPORT CONTENT (most recent first):\n${reportSummaries}`
        : '';
    return `You are implementing a feature defined in the project specs.\n\nTarget spec: specs/${specFile}\n\nInstructions:\n1. Read the target spec file in the specs directory and any relevant supporting specs (system-*.md, architecture, schema).\n2. Implement the requirements in that spec.\n3. Follow the acceptance criteria precisely.\n4. Address any gaps identified in previous validation feedback.\n5. Review prior execution/validation reports and avoid repeating known issues.\n6. Explain significant implementation decisions.\n\n${contextHint}${reportSection}${reportContentSection}\n\nCURRENT CODEBASE STATE (summary):\n${codebaseSummary}\n\nPREVIOUS VALIDATION FEEDBACK (if any):\n${validationFeedback}`;
}
async function buildValidationPrompt(specContent, contextDocs, cwd, specFile) {
    const codebaseContent = await readCodebaseContent(cwd);
    const contextHint = contextDocs.length > 0
        ? 'System/architecture specs are present in the specs directory and should be used for context.'
        : 'Use any relevant supporting specs in the specs directory for context.';
    return `You are validating an implementation against its specification.\n\nTarget spec: specs/${specFile}\n\nInstructions:\n1. Read the target spec file in the specs directory and any relevant supporting specs (system-*.md, architecture, schema).\n2. Read the codebase thoroughly.\n3. Compare implementation to each requirement in the spec.\n4. Identify gaps, missing features, or deviations.\n5. Rate implementation completeness (0-100%).\n6. List specific issues that must be addressed.\n\n${contextHint}\n\nIMPLEMENTATION (current codebase):\n${codebaseContent}\n\nSTRICT OUTPUT REQUIRED: Return ONLY a single JSON object with exactly one key named "response_block".\nThe value must be ONLY the following response format block and nothing else.\nCOMPLETENESS: {percentage}%\nSTATUS: {PASS|FAIL}\nGAPS:\n- {gap_1}\n- {gap_2}\nRECOMMENDATIONS:\n- {recommendation_1}`;
}
async function readCodebaseContent(cwd) {
    const files = await listFilesRecursive(cwd, {
        excludeDirs: ['node_modules', 'dist', '.git', '.ai-coord', 'specs', 'data'],
        limit: 100
    });
    const chunks = [];
    for (const file of files) {
        const stat = await fs.stat(file);
        if (stat.size > 50_000) {
            continue;
        }
        const content = await fs.readFile(file, 'utf8');
        if (!looksLikeText(content)) {
            continue;
        }
        chunks.push(`# ${path.relative(cwd, file)}\n${content}`);
    }
    return chunks.join('\n\n');
}
function toValidation(tool, prompt, result) {
    let parsed;
    try {
        parsed = parseValidationOutput(result.output);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Validator ${tool} output invalid: ${message}`);
    }
    return {
        tool: tool,
        prompt,
        output: result.output,
        parsed,
        durationMs: result.durationMs,
        exitCode: result.exitCode
    };
}
export function parseValidationOutput(output) {
    const cleanedOutput = stripTrailingResponseTemplate(extractResponseBlock(output));
    const completenessMatch = cleanedOutput.match(/COMPLETENESS:\s*(\d+)%/i);
    const statusMatch = cleanedOutput.match(/STATUS:\s*(PASS|FAIL)/i);
    if (!completenessMatch || !statusMatch) {
        throw new Error('Validator output missing required response format (COMPLETENESS/STATUS).');
    }
    const completeness = Number(completenessMatch[1]);
    const status = statusMatch[1].toUpperCase();
    const gaps = extractBullets(cleanedOutput, 'GAPS:');
    const recommendations = extractBullets(cleanedOutput, 'RECOMMENDATIONS:');
    return { completeness, status, gaps, recommendations };
}
function extractBullets(output, section) {
    const index = output.toUpperCase().indexOf(section.toUpperCase());
    if (index === -1) {
        return [];
    }
    const lines = output.slice(index).split('\n').slice(1);
    const items = [];
    for (const line of lines) {
        const match = line.match(/^\s*-\s+(.*)/);
        if (match) {
            items.push(match[1].trim());
        }
        else if (line.trim() !== '' && !line.startsWith(' ')) {
            break;
        }
    }
    return items;
}
// Strict parsing enforced; missing fields should error out.
function stripTrailingResponseTemplate(output) {
    const index = output.toLowerCase().indexOf('response format:');
    if (index === -1) {
        return output;
    }
    return output.slice(0, index).trim();
}
function extractResponseBlock(output) {
    const trimmed = output.trim();
    if (!trimmed) {
        return output;
    }
    if (!trimmed.startsWith('{')) {
        return output;
    }
    try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed.response_block === 'string') {
            return parsed.response_block;
        }
        const content = parsed.content;
        if (Array.isArray(content)) {
            const text = content
                .map((item) => (item && typeof item === 'object' && 'text' in item ? String(item.text) : ''))
                .join('');
            if (text.trim()) {
                return text;
            }
        }
        if (typeof content === 'string' && content.trim()) {
            return content;
        }
        if (typeof parsed.text === 'string' && parsed.text.trim()) {
            return parsed.text;
        }
    }
    catch {
        // Not JSON; fall through to raw output.
    }
    return output;
}
function looksLikeText(content) {
    if (content.includes('\u0000')) {
        return false;
    }
    const sample = content.slice(0, 4000);
    if (sample.length === 0) {
        return false;
    }
    let nonPrintable = 0;
    for (let i = 0; i < sample.length; i += 1) {
        const code = sample.charCodeAt(i);
        if (code === 9 || code === 10 || code === 13) {
            continue;
        }
        if (code < 32 || code > 126) {
            nonPrintable += 1;
        }
    }
    return nonPrintable / sample.length < 0.2;
}
export function hasConsensus(validations) {
    if (validations.length === 0) {
        return false;
    }
    const passCount = validations.filter((validation) => validation.status === 'PASS').length;
    if (validations.length === 1) {
        return passCount === 1;
    }
    if (validations.length === 2) {
        return passCount === 2;
    }
    return passCount >= 2;
}
async function runLeadWithRetry(runner, tool, prompt, cwd, timeoutMs) {
    const first = await runner.runLead(tool, prompt, cwd, timeoutMs);
    if (first.exitCode === 0) {
        return first;
    }
    const second = await runner.runLead(tool, prompt, cwd, timeoutMs);
    if (second.exitCode !== 0) {
        if (!second.output || second.output.trim().length === 0) {
            return second;
        }
        throw new Error(`Lead execution failed after retry: ${tool}`);
    }
    return second;
}
function buildValidationFeedback(validations) {
    const failing = validations.filter((validation) => validation.parsed.status === 'FAIL');
    if (failing.length === 0) {
        return '';
    }
    const lines = ['Validator gaps:'];
    for (const validation of failing) {
        const gaps = validation.parsed.gaps.join('; ') || 'No gaps provided';
        lines.push(`- ${validation.tool}: ${gaps}`);
    }
    return lines.join('\n');
}
async function generateReport(session, env) {
    const reportsDir = getProjectReportsDir(session.workingDirectory);
    await ensureDir(reportsDir);
    const reportPath = path.join(reportsDir, `${session.id}-report.md`);
    const lines = [
        '# AI Spec Coordinator Report',
        '',
        `Session: ${session.id}`,
        `Status: ${session.status}`,
        `Working Directory: ${session.workingDirectory}`,
        '',
        `Lead: ${session.lead}`,
        `Validators: ${session.validators.join(', ')}`,
        ''
    ];
    lines.push('## Specs');
    for (const spec of session.specs) {
        const cycles = spec.cycles.length;
        const lastCycle = cycles > 0 ? spec.cycles[cycles - 1] : undefined;
        const completeness = lastCycle
            ? Math.round(lastCycle.validations.reduce((sum, validation) => sum + validation.parsed.completeness, 0) / Math.max(lastCycle.validations.length, 1))
            : 0;
        lines.push(`### ${spec.meta.name} (${spec.file})`);
        lines.push(`- Status: ${spec.status}`);
        lines.push(`- Complexity: ${spec.meta.complexity}`);
        lines.push(`- Maturity: ${spec.meta.maturity}`);
        lines.push(`- Cycles to consensus: ${spec.status === 'completed' ? cycles : 'N/A'}`);
        lines.push(`- Final completeness: ${completeness}%`);
        lines.push(`- Key implementation decisions: Not captured`);
        if (lastCycle && spec.status !== 'completed') {
            const gaps = lastCycle.validations.flatMap((validation) => validation.parsed.gaps);
            if (gaps.length > 0) {
                lines.push('- Gap analysis:');
                gaps.forEach((gap) => lines.push(`  - ${gap}`));
            }
        }
        lines.push('');
    }
    const completed = session.specs.filter((spec) => spec.status === 'completed').length;
    lines.push('## Summary');
    lines.push(`- Total specs: ${session.specs.length}`);
    lines.push(`- Completed specs: ${completed}`);
    lines.push(`- Success rate: ${Math.round((completed / Math.max(session.specs.length, 1)) * 100)}%`);
    lines.push('');
    await writeTextFile(reportPath, lines.join('\n'));
}
function formatStartSummary(input) {
    const lines = [
        'AI Spec Coordinator',
        `Working Directory: ${input.cwd}`,
        `Specs Directory: ${input.specsDir}`,
        ''
    ];
    if (input.isResume) {
        lines.push('Resuming previous session.');
        lines.push('');
    }
    lines.push(`Specs to build (${input.specs.length}):`);
    input.specs.forEach((spec, index) => {
        const deps = spec.meta.dependsOn && spec.meta.dependsOn.length > 0 ? ` [depends: ${spec.meta.dependsOn.join(', ')}]` : '';
        lines.push(`${index + 1}. ${spec.file} (${spec.meta.complexity}, Level ${spec.meta.maturity})${deps}`);
    });
    lines.push('');
    lines.push(`Lead (${input.lead}): Full permissions in working directory`);
    lines.push(`Validators (${input.validators.join(', ')}): Read-only access`);
    lines.push('');
    return `${lines.join('\n')}\n`;
}
async function startCountdown(output, seconds = 3) {
    output.write(`Starting in ${seconds} seconds... (Ctrl+C to cancel)\n`);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}
async function confirmProceed() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        const answer = await rl.question('Continue? [y/N] ');
        return answer.trim().toLowerCase() === 'y';
    }
    finally {
        rl.close();
    }
}
async function autoCleanState(cwd) {
    const threshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const dirs = [getProjectSessionsDir(cwd), getProjectLogsDir(cwd), getProjectReportsDir(cwd)];
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
            }
        }
    }
}
async function ensureSandboxAvailable() {
    try {
        await execa('docker', ['--version']);
    }
    catch {
        throw new Error('Sandbox mode requires Docker to be installed and available on PATH.');
    }
}
function needsResume(session) {
    if (session.status === 'completed') {
        return false;
    }
    return session.specs.some((spec) => spec.status !== 'completed' && spec.status !== 'skipped');
}
async function confirmResume() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    const response = await rl.question('Previous run found without consensus. Resume? [Y/n] ');
    rl.close();
    return response.trim().toLowerCase() !== 'n';
}
async function loadCompletedSpecKeys(cwd) {
    const completed = new Set();
    const sessionsDir = getProjectSessionsDir(cwd);
    if (!(await pathExists(sessionsDir))) {
        return completed;
    }
    const files = await fs.readdir(sessionsDir);
    for (const file of files) {
        if (!file.endsWith('.json')) {
            continue;
        }
        try {
            const content = await fs.readFile(path.join(sessionsDir, file), 'utf8');
            const parsed = JSON.parse(content);
            for (const spec of parsed.specs ?? []) {
                if (spec.status === 'completed') {
                    if (spec.meta?.id) {
                        completed.add(spec.meta.id);
                    }
                    if (spec.file) {
                        completed.add(spec.file);
                    }
                }
            }
        }
        catch {
            // Ignore unreadable session files.
        }
    }
    return completed;
}
async function hasImplementationArtifacts(cwd) {
    const files = await listFilesRecursive(cwd, {
        excludeDirs: ['node_modules', 'dist', '.git', '.ai-coord', 'specs', 'data'],
        limit: 5
    });
    return files.length > 0;
}
async function getRecentReportSummaries(cwd, specId, limit) {
    const reportsDir = getProjectReportsDir(cwd);
    if (!(await pathExists(reportsDir))) {
        return '';
    }
    const safeSpec = specId.replace(/[^a-z0-9-_]/gi, '_');
    const entries = await fs.readdir(reportsDir);
    const candidates = await Promise.all(entries
        .filter((entry) => entry.includes(`-${safeSpec}-`) && entry.endsWith('.md'))
        .map(async (entry) => {
        const filePath = path.join(reportsDir, entry);
        const stat = await fs.stat(filePath);
        return { filePath, mtimeMs: stat.mtimeMs };
    }));
    const sorted = candidates.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit);
    const summaries = [];
    for (const entry of sorted) {
        const content = await fs.readFile(entry.filePath, 'utf8');
        const trimmed = content.trim().slice(0, 8000);
        summaries.push(`# ${path.basename(entry.filePath)}\n${trimmed}`);
    }
    return summaries.join('\n\n');
}
async function runValidationPass(input) {
    const validationSpinner = ora({ isEnabled: false });
    const label = input.cycleNumber === 0
        ? 'Preflight: Validators running'
        : `Cycle ${input.cycleNumber}/${input.session.config.maxIterations}: Validators running`;
    validationSpinner.start(label);
    await ensureDir(getProjectReportsDir(input.cwd));
    const validations = await Promise.all(input.roleAssignment.validators.map(async (tool) => {
        if (input.options.verbose) {
            input.output.write(`[validator:${tool}] starting\n`);
        }
        let result = await input.runner.runValidator(tool, input.validationPrompt, input.cwd, input.timeoutMs);
        if (input.options.verbose && !result.streamed && result.output) {
            input.output.write(`${result.output}\n`);
        }
        if (input.onProcessComplete) {
            input.onProcessComplete();
        }
        const reportPath = buildValidationReportPath(input.cwd, input.session.id, input.specEntry.meta.id, input.cycleNumber, tool);
        try {
            const validation = toValidation(tool, input.validationPrompt, result);
            await writeTextFile(reportPath, result.output || 'No output captured.');
            if (input.options.verbose) {
                input.output.write(`[report] ${reportPath}\n`);
            }
            return validation;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!message.includes('Validator output missing required response format')) {
                await writeTextFile(reportPath, result.output || 'No output captured.');
                if (input.options.verbose) {
                    input.output.write(`[report] ${reportPath}\n`);
                }
                throw error;
            }
            const retryPrompt = buildValidationRetryPrompt(input.validationPrompt);
            if (input.options.verbose) {
                input.output.write(`[validator:${tool}] retrying with format recovery\n`);
            }
            result = await input.runner.runValidator(tool, retryPrompt, input.cwd, input.timeoutMs);
            if (input.options.verbose && !result.streamed && result.output) {
                input.output.write(`${result.output}\n`);
            }
            if (input.onProcessComplete) {
                input.onProcessComplete();
            }
            try {
                const validation = toValidation(tool, retryPrompt, result);
                await writeTextFile(reportPath, result.output || 'No output captured.');
                if (input.options.verbose) {
                    input.output.write(`[report] ${reportPath}\n`);
                }
                return validation;
            }
            catch (retryError) {
                const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
                const fallbackOutput = [
                    result.output || 'No output captured.',
                    `ERROR: Validator output invalid after retry: ${retryMessage}`
                ].join('\n');
                await writeTextFile(reportPath, fallbackOutput);
                if (input.options.verbose) {
                    input.output.write(`[report] ${reportPath}\n`);
                }
                return {
                    tool,
                    prompt: retryPrompt,
                    output: result.output,
                    parsed: {
                        completeness: 0,
                        status: 'FAIL',
                        gaps: [`Validator output invalid after retry: ${retryMessage}`],
                        recommendations: ['Re-run validator or inspect logs for tool output formatting issues.']
                    },
                    durationMs: result.durationMs,
                    exitCode: result.exitCode
                };
            }
        }
    }));
    validationSpinner.stop();
    return validations;
}
function buildValidationRetryPrompt(prompt) {
    return `${prompt}\n\nFORMAT RECOVERY: You must return ONLY JSON with one key \"response_block\".\nThe value must be ONLY the response format block (COMPLETENESS/STATUS/GAPS/RECOMMENDATIONS).`;
}
function buildValidationReportPath(cwd, sessionId, specId, cycleNumber, tool) {
    const safeSpec = specId.replace(/[^a-z0-9-_]/gi, '_');
    return path.join(getProjectReportsDir(cwd), `${sessionId}-${safeSpec}-cycle-${cycleNumber}-${tool}.md`);
}
function buildLeadReportPath(cwd, sessionId, specId, cycleNumber, tool) {
    const safeSpec = specId.replace(/[^a-z0-9-_]/gi, '_');
    return path.join(getProjectReportsDir(cwd), `${sessionId}-${safeSpec}-cycle-${cycleNumber}-${tool}-lead.md`);
}
async function getPreviousReportFiles(cwd, sessionId, specId, cycleNumber, validators) {
    if (cycleNumber < 1) {
        return [];
    }
    const files = [];
    for (const tool of validators) {
        const filePath = buildValidationReportPath(cwd, sessionId, specId, cycleNumber, tool);
        if (await pathExists(filePath)) {
            files.push(filePath);
        }
    }
    return files;
}
