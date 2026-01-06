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
    const toolThrottleMs = getToolThrottleMs(context.env);
    let lastToolCallAt = 0;
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
    let leadTool = roleAssignment.lead;
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
        output.write(formatDryRun(entries, leadTool, roleAssignment.validators));
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
            lead: leadTool,
            validators: roleAssignment.validators,
            config: {
                maxIterations: options.maxIterations,
                maxIterationsPerRun: options.maxIterationsPerRun,
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
    let activeValidators = session.validators;
    if (session) {
        const adjusted = normalizeResumedRoles(session, availableTools);
        if (adjusted.changed) {
            session.lead = adjusted.lead;
            session.validators = adjusted.validators;
        }
        if (session.config.maxIterations !== options.maxIterations) {
            session.config.maxIterations = options.maxIterations;
        }
        if (session.config.maxIterationsPerRun !== options.maxIterationsPerRun) {
            session.config.maxIterationsPerRun = options.maxIterationsPerRun;
        }
        await persistSession(session, context.env);
        leadTool = session.lead;
        activeValidators = session.validators;
    }
    output.write(formatStartSummary({
        cwd,
        specsDir,
        specs: entries,
        lead: leadTool,
        validators: activeValidators,
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
        const totalIterations = session.config.maxIterations;
        const totalCycles = specEntry.cycles.length;
        const remainingCycles = Math.max(0, totalIterations - totalCycles);
        const runIterations = Math.max(1, options.maxIterationsPerRun);
        const runCycles = Math.min(remainingCycles, runIterations);
        if (remainingCycles === 0) {
            const maxMessage = `Max total iterations reached for ${specEntry.file} (${totalCycles}/${totalIterations}). Manual review required.`;
            specEntry.status = 'skipped';
            specEntry.completedAt = new Date().toISOString();
            specEntry.lastError = maxMessage;
            session.status = 'partial';
            await persistSession(session, context.env);
            if (!options.quiet) {
                output.write(chalk.yellow(`${maxMessage}\n`));
            }
            continue;
        }
        specEntry.status = 'in_progress';
        specEntry.startedAt = new Date().toISOString();
        await persistSession(session, context.env);
        let validationFeedback = '';
        let validateOnly = false;
        let validationIterations = runCycles;
        const wasCompleted = completedSpecs.has(specEntry.meta.id) || completedSpecs.has(specEntry.file);
        if (options.preflight && (hasCodeArtifacts || wasCompleted)) {
            if (!options.quiet) {
                output.write(`Preflight validation for ${specEntry.file}...\n`);
            }
            const validationPrompt = await buildValidationPrompt(specContent, contextDocs, cwd, specEntry.file);
            const preflightCap = Math.min(runIterations + 1, remainingCycles);
            const validations = await runValidationPass({
                cycleNumber: 0,
                specEntry,
                session,
                validationPrompt,
                roleAssignment: { validators: activeValidators },
                runner,
                cwd,
                timeoutMs: options.timeout * 60_000,
                output,
                options,
                currentRunIterations: validationIterations,
                totalCyclesBeforeRun: totalCycles,
                preflightTotalCap: totalCycles + preflightCap,
                logger,
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
                validationIterations = Math.min(options.preflightIterations, preflightCap);
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
            const totalCycleNumber = totalCycles + cycleNumber;
            const cycleStart = new Date().toISOString();
            const previousReports = await getPreviousReportFiles(cwd, session.id, specEntry.meta.id, cycleNumber - 1, activeValidators);
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
                const fallbackLeads = buildLeadFallbacks(leadTool, availableTools);
                let lastError = null;
                for (let index = 0; index < fallbackLeads.length; index += 1) {
                    const candidate = fallbackLeads[index];
                    spinner.start(`Cycle ${cycleNumber}/${validationIterations} (total ${totalCycleNumber}/${totalIterations}): Lead implementing ${specEntry.file}`);
                    if (options.verbose) {
                        output.write(`[lead:${candidate}] starting\n`);
                    }
                    try {
                        await throttleToolCall(toolThrottleMs, () => {
                            lastToolCallAt = Date.now();
                        }, lastToolCallAt);
                        leadResult = await runLeadWithRetry(runner, candidate, leadPrompt, cwd, options.timeout * 60_000, logger);
                        lastToolCallAt = Date.now();
                        leadTool = candidate;
                        session.lead = candidate;
                        break;
                    }
                    catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        lastError = error instanceof Error ? error : new Error(message);
                        if (isLeadRateLimitError(error) || isRateLimitMessage(message)) {
                            if (index < fallbackLeads.length - 1) {
                                const nextLead = fallbackLeads[index + 1];
                                if (!options.quiet) {
                                    output.write(`Lead ${candidate} rate limited. Switching to ${nextLead}.\n`);
                                }
                                logger.warn({ from: candidate, to: nextLead }, 'Lead rate limit detected; switching lead tool');
                                leadTool = nextLead;
                                session.lead = nextLead;
                                activeValidators = session.validators.filter((tool) => tool !== leadTool);
                                if (activeValidators.length === 0) {
                                    activeValidators = availableTools.filter((tool) => tool !== leadTool);
                                    session.validators = activeValidators;
                                }
                                if (toolThrottleMs > 0) {
                                    await sleep(toolThrottleMs);
                                    lastToolCallAt = Date.now();
                                }
                                await persistSession(session, context.env);
                                continue;
                            }
                        }
                        throw error;
                    }
                    finally {
                        spinner.stop();
                        activeProcess = null;
                        if (heartbeatTimer) {
                            clearInterval(heartbeatTimer);
                            heartbeatTimer = null;
                        }
                    }
                }
                if (!leadResult) {
                    throw lastError ?? new Error('Lead execution failed with no result.');
                }
                if (options.verbose && !leadResult.streamed && leadResult.output) {
                    output.write(`${leadResult.output}\n`);
                }
                const leadReportPath = buildLeadReportPath(cwd, session.id, specEntry.meta.id, cycleNumber, leadTool);
                if (!leadResult.output || leadResult.output.trim().length === 0) {
                    const durationSeconds = Math.max(1, Math.round(leadResult.durationMs / 1000));
                    const leadFailureMessage = [
                        `Lead tool ${leadTool} returned no output.`,
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
                    logger.error({ cycle: cycleNumber, tool: leadTool, exitCode: leadResult.exitCode, durationMs: leadResult.durationMs }, leadFailureMessage);
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
            logger.info({ cycle: cycleNumber, tool: leadTool }, 'Lead execution completed');
            if (options.verbose) {
                logger.info({ cycle: cycleNumber, tool: leadTool, output: leadResult.output }, 'Lead output');
            }
            const validationPrompt = await buildValidationPrompt(specContent, contextDocs, cwd, specEntry.file);
            const validations = await runValidationPass({
                cycleNumber,
                specEntry,
                session,
                validationPrompt,
                roleAssignment: { validators: activeValidators },
                runner,
                cwd,
                timeoutMs: options.timeout * 60_000,
                output,
                options,
                currentRunIterations: validationIterations,
                totalCyclesBeforeRun: totalCycles,
                throttle: async () => {
                    await throttleToolCall(toolThrottleMs, () => {
                        lastToolCallAt = Date.now();
                    }, lastToolCallAt);
                    lastToolCallAt = Date.now();
                },
                logger,
                onProcessComplete: () => {
                    activeProcess = null;
                    if (heartbeatTimer) {
                        clearInterval(heartbeatTimer);
                        heartbeatTimer = null;
                    }
                }
            });
            if (!options.quiet) {
                const gapLines = [];
                validations.forEach((validation) => {
                    const gaps = validation.parsed.gaps;
                    if (gaps.length === 0) {
                        gapLines.push(`- ${validation.tool}: no gaps reported`);
                        return;
                    }
                    gaps.forEach((gap) => {
                        gapLines.push(`- ${validation.tool}: ${gap}`);
                    });
                });
                if (gapLines.length > 0) {
                    output.write(`Validator gaps for ${specEntry.file}:\n`);
                    output.write(`${gapLines.join('\n')}\n`);
                }
            }
            if (options.verbose) {
                validations.forEach((validation) => {
                    logger.info({ cycle: cycleNumber, tool: validation.tool, output: validation.output }, 'Validator output');
                });
            }
            const consensusReached = hasConsensus(validations.map((validation) => validation.parsed))
                || validations.every((validation) => validation.parsed.gaps.length === 0);
            if (!consensusReached) {
                validationFeedback = buildValidationFeedback(validations);
            }
            specEntry.cycles.push({
                number: cycleNumber,
                specId: specEntry.meta.id,
                startedAt: cycleStart,
                completedAt: new Date().toISOString(),
                leadExecution: {
                    tool: leadTool,
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
                if (totalCycleNumber >= totalIterations) {
                    const maxMessage = `Max total iterations reached for ${specEntry.file} (${totalCycleNumber}/${totalIterations}). Manual review required.`;
                    specEntry.status = 'skipped';
                    specEntry.completedAt = new Date().toISOString();
                    specEntry.lastError = maxMessage;
                    session.status = 'partial';
                    output.write(chalk.yellow(`${maxMessage}\n`));
                    if (session.config.stopOnFailure) {
                        await persistSession(session, context.env);
                        await generateReport(session, context.env);
                        return;
                    }
                }
                else {
                    specEntry.status = 'failed';
                    output.write(chalk.yellow(`Run iteration limit reached for ${specEntry.file} (${cycleNumber}/${validationIterations}). Resume to continue.\n`));
                }
            }
            else {
                output.write(`Cycle ${cycleNumber}/${validationIterations} (total ${totalCycleNumber}/${totalIterations}): Lead completed, awaiting validation...\n`);
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
export async function runValidationOnly(options, context, deps = {}) {
    const cwd = context.cwd;
    const output = context.output;
    const toolThrottleMs = getToolThrottleMs(context.env);
    let lastToolCallAt = 0;
    const spinner = ora({ isEnabled: false });
    await autoCleanState(cwd);
    spinner.start('Detecting tools');
    const registry = await detectTools(context.env);
    spinner.stop();
    const availableValidators = [...registry.available.keys()];
    if (availableValidators.length === 0) {
        throw new Error('No AI tools found. Install at least one: claude, codex, or gemini');
    }
    const requestedValidators = options.validators
        ? options.validators.split(',').map((value) => value.trim()).filter(Boolean)
        : undefined;
    if (requestedValidators && requestedValidators.length > 0) {
        const missing = requestedValidators.filter((tool) => !registry.available.has(tool));
        if (missing.length > 0) {
            throw new Error(`Requested validator tool(s) not available: ${missing.join(', ')}`);
        }
    }
    const validators = requestedValidators && requestedValidators.length > 0
        ? requestedValidators
        : availableValidators;
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
    const session = await createSession({
        cwd,
        specs: entries,
        lead: validators[0],
        validators,
        config: {
            maxIterations: 1,
            maxIterationsPerRun: 1,
            timeoutPerCycle: options.timeout,
            leadPermissions: undefined,
            sandbox: false,
            stopOnFailure: false,
            verbose: options.verbose,
            quiet: options.quiet,
            preflight: false,
            preflightThreshold: 0,
            preflightIterations: 0
        },
        env: context.env
    });
    output.write(formatStartSummary({
        cwd,
        specsDir,
        specs: entries,
        lead: validators[0],
        validators,
        isResume: false
    }));
    if (!options.quiet) {
        await startCountdown(output);
    }
    const logger = await createLogger(session.id, cwd);
    logger.info({ sessionId: session.id }, 'Validation session started');
    let activeProcess = null;
    let heartbeatTimer = null;
    const heartbeatSeconds = Math.max(0, Number.isFinite(options.heartbeat) ? options.heartbeat : 0);
    const runner = deps.runner ?? new DefaultToolRunner({
        interactive: false,
        leadPermissions: undefined,
        sandbox: false,
        sandboxImage: context.env.AIC_SANDBOX_IMAGE ?? 'node:20',
        verbose: options.verbose,
        output,
        inheritStdin: false,
        env: context.env,
        onSpawn: (info) => {
            activeProcess = info.child;
            if (heartbeatSeconds > 0) {
                if (heartbeatTimer) {
                    clearInterval(heartbeatTimer);
                }
                heartbeatTimer = setInterval(() => {
                    output.write(`- Heartbeat: ${info.command} running (${info.args.join(' ')})\n`);
                }, heartbeatSeconds * 1000);
            }
        }
    });
    const handleSigint = () => {
        output.write('\nInterrupted. Saving session state...\n');
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
    };
    process.on('SIGINT', handleSigint);
    process.on('SIGTERM', handleSigint);
    for (let i = 0; i < session.specs.length; i += 1) {
        const specEntry = session.specs[i];
        session.currentSpecIndex = i;
        if (specEntry.contextOnly) {
            specEntry.status = 'skipped';
            await persistSession(session, context.env);
            continue;
        }
        const specContent = orderedLoaded.find((spec) => spec.entry.path === specEntry.path)?.content ?? '';
        specEntry.status = 'in_progress';
        specEntry.startedAt = new Date().toISOString();
        await persistSession(session, context.env);
        const validationPrompt = await buildValidationPrompt(specContent, [], cwd, specEntry.file);
        const validations = await runValidationPass({
            cycleNumber: 1,
            specEntry,
            session,
            validationPrompt,
            roleAssignment: { validators },
            runner,
            cwd,
            timeoutMs: options.timeout * 60_000,
            output,
            options: {
                specs: undefined,
                exclude: undefined,
                lead: undefined,
                validators: validators.join(','),
                maxIterations: 1,
                maxIterationsPerRun: 1,
                timeout: options.timeout,
                resume: false,
                stopOnFailure: false,
                leadPermissions: undefined,
                sandbox: false,
                interactive: false,
                verbose: options.verbose,
                heartbeat: options.heartbeat,
                quiet: options.quiet,
                dryRun: false,
                preflight: false,
                preflightThreshold: 0,
                preflightIterations: 0,
                startOver: false
            },
            currentRunIterations: 1,
            totalCyclesBeforeRun: specEntry.cycles.length,
            throttle: async () => {
                await throttleToolCall(toolThrottleMs, () => {
                    lastToolCallAt = Date.now();
                }, lastToolCallAt);
                lastToolCallAt = Date.now();
            },
            logger,
            onProcessComplete: () => {
                activeProcess = null;
                if (heartbeatTimer) {
                    clearInterval(heartbeatTimer);
                    heartbeatTimer = null;
                }
            }
        });
        if (!options.quiet) {
            const gapLines = [];
            validations.forEach((validation) => {
                const gaps = validation.parsed.gaps;
                if (gaps.length === 0) {
                    gapLines.push(`- ${validation.tool}: no gaps reported`);
                    return;
                }
                gaps.forEach((gap) => {
                    gapLines.push(`- ${validation.tool}: ${gap}`);
                });
            });
            if (gapLines.length > 0) {
                output.write(`Validator gaps for ${specEntry.file}:\n`);
                output.write(`${gapLines.join('\n')}\n`);
            }
        }
        const consensusReached = hasConsensus(validations.map((validation) => validation.parsed));
        specEntry.status = consensusReached ? 'completed' : 'failed';
        specEntry.completedAt = new Date().toISOString();
        specEntry.cycles.push({
            number: 1,
            specId: specEntry.meta.id,
            startedAt: specEntry.startedAt,
            completedAt: specEntry.completedAt,
            leadExecution: {
                tool: validators[0],
                prompt: 'Validation-only run.',
                output: 'Validation-only run.',
                filesModified: [],
                durationMs: 0,
                exitCode: 0
            },
            validations,
            consensusReached
        });
        await persistSession(session, context.env);
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
    if (validationFeedback) {
        return `You are continuing implementation based on validator feedback.\n\nTarget spec: specs/${specFile}\n\nInstructions:\n1. Read the target spec file in the specs directory and any relevant supporting specs (system-*.md, architecture, schema).\n2. Read and understand the existing codebase.\n3. Resolve each gap listed below using concrete code changes only.\n4. Do not re-implement features that already meet the spec unless required by a gap.\n5. Explain significant implementation decisions.\n\n${contextHint}${reportSection}${reportContentSection}\n\nCURRENT CODEBASE STATE (summary):\n${codebaseSummary}\n\nVALIDATOR GAPS TO RESOLVE:\n${validationFeedback}`;
    }
    return `You are implementing a feature defined in the project specs.\n\nTarget spec: specs/${specFile}\n\nInstructions:\n1. Read the target spec file in the specs directory and any relevant supporting specs (system-*.md, architecture, schema).\n2. Implement the requirements in that spec end-to-end.\n3. Follow the acceptance criteria precisely.\n4. Review prior execution/validation reports and avoid repeating known issues.\n5. Explain significant implementation decisions.\n\n${contextHint}${reportSection}${reportContentSection}\n\nCURRENT CODEBASE STATE (summary):\n${codebaseSummary}\n\nPREVIOUS VALIDATION FEEDBACK (if any):\n${validationFeedback}`;
}
async function buildValidationPrompt(specContent, contextDocs, cwd, specFile) {
    const contextHint = contextDocs.length > 0
        ? 'System/architecture specs are present in the specs directory and should be used for context.'
        : 'Use any relevant supporting specs in the specs directory for context.';
    return `You are validating an implementation against its specification.\n\nTarget spec: specs/${specFile}\n\nAct as a strict reviewer: find edge cases, type holes, exception paths, security issues, and behavior mismatches. Propose a concrete diff for each finding.\n\nInstructions:\n1. Read the target spec file in the specs directory and any relevant supporting specs (system-*.md, architecture, schema).\n2. Use Read, Grep, Glob, and other file tools to explore and understand the codebase thoroughly.\n3. Compare implementation to each requirement in the spec.\n4. Identify gaps, missing features, or deviations.\n5. Rate implementation completeness (0-100%).\n6. Produce findings with exact references and proposed code changes.\n\n${contextHint}\n\nIMPORTANT: You have access to the working directory. Use your file reading tools (Read, Grep, Glob, etc.) to examine the codebase.\n\nCRITICAL OUTPUT FORMAT REQUIREMENTS:
- Return ONLY valid JSON
- Do NOT include markdown code blocks (no \`\`\`)
- Do NOT include any explanatory text before or after the JSON
- Do NOT include any comments within the JSON
- Your entire response must be EXACTLY this JSON structure:

{
  "response_block": {
    "completeness": 85,
    "status": "FAIL",
    "findings": [
      {
        "spec_requirement": "Example requirement from spec",
        "gap_description": "Description of what's missing",
        "original_code": "Current code snippet",
        "proposed_diff": "Suggested change"
      }
    ],
    "recommendations": ["First recommendation", "Second recommendation"]
  }
}

FIELD REQUIREMENTS:
- "completeness": MUST be a number from 0 to 100 (not a string)
- "status": MUST be exactly "PASS" or "FAIL" (case-sensitive)
- "findings": MUST be an array (use [] if no findings)
- "recommendations": MUST be an array (use [] if no recommendations)
- Each finding MUST have all four fields: spec_requirement, gap_description, original_code, proposed_diff`;
}
async function readCodebaseContent(cwd) {
    const files = await listFilesRecursive(cwd, {
        excludeDirs: ['node_modules', 'dist', '.git', '.ai-coord', 'specs', 'data'],
        limit: 100
    });
    const chunks = [];
    let totalSize = 0;
    const maxTotalSize = 500_000; // 500KB total limit to avoid context overflow
    for (const file of files) {
        const stat = await fs.stat(file);
        if (stat.size > 50_000) {
            continue;
        }
        const content = await fs.readFile(file, 'utf8');
        if (!looksLikeText(content)) {
            continue;
        }
        const chunk = `# ${path.relative(cwd, file)}\n${content}`;
        if (totalSize + chunk.length > maxTotalSize) {
            chunks.push(`\n... (${files.length - chunks.length} more files omitted to stay within context limits)`);
            break;
        }
        chunks.push(chunk);
        totalSize += chunk.length;
    }
    return chunks.join('\n\n');
}
function toValidation(tool, prompt, result) {
    // Check for common tool errors before trying to parse as validation output
    const lowerOutput = result.output.toLowerCase();
    if (lowerOutput.includes('prompt is too long') || lowerOutput.includes('prompt too long')) {
        throw new Error(`Validator ${tool} failed: Prompt exceeds tool's context limit. Consider reducing codebase size or using --exclude.`);
    }
    if (lowerOutput.includes('usage limit') || lowerOutput.includes('rate limit')) {
        throw new Error(`Validator ${tool} failed: Usage/rate limit reached. Try again later or use a different validator.`);
    }
    if (lowerOutput.includes('authentication') || lowerOutput.includes('not authenticated')) {
        throw new Error(`Validator ${tool} failed: Authentication error. Check tool credentials.`);
    }
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
    const structured = parseStructuredValidation(output);
    if (structured) {
        return structured;
    }
    throw new Error('Validator output missing required JSON response format.');
}
function parseStructuredValidation(output) {
    const trimmed = output.trim();
    let jsonText = trimmed;
    // Extract JSON from markdown code blocks if present
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
        jsonText = codeBlockMatch[1].trim();
    }
    if (!jsonText.startsWith('{')) {
        throw new Error('Validator output missing required JSON response format.');
    }
    // Try to extract just the JSON portion if there's extra text after it
    // This handles cases where tools output JSON followed by additional content
    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    }
    catch (error) {
        // If parsing fails, try to extract just the JSON object
        const message = error instanceof Error ? error.message : String(error);
        const match = message.match(/position (\d+)/);
        if (match) {
            const position = parseInt(match[1], 10);
            // Try parsing just up to the error position
            try {
                parsed = JSON.parse(jsonText.substring(0, position));
            }
            catch {
                throw new Error(`Validator output JSON parse error: ${message}`);
            }
        }
        else {
            throw new Error(`Validator output JSON parse error: ${message}`);
        }
    }
    const response = parsed.response_block ?? parsed;
    if (!response || typeof response !== 'object') {
        throw new Error('Validator output JSON missing response_block object.');
    }
    const record = response;
    const completenessValue = record.completeness;
    const statusValue = record.status;
    // Provide detailed error messages for missing or invalid fields
    if (completenessValue === undefined) {
        const availableFields = Object.keys(record).join(', ');
        throw new Error(`Validator output JSON missing "completeness" field. Available fields: ${availableFields}`);
    }
    if (typeof completenessValue !== 'number') {
        throw new Error(`Validator output JSON "completeness" field must be a number, got: ${typeof completenessValue}`);
    }
    if (statusValue === undefined) {
        throw new Error('Validator output JSON missing "status" field.');
    }
    if (statusValue !== 'PASS' && statusValue !== 'FAIL') {
        throw new Error(`Validator output JSON "status" field must be "PASS" or "FAIL", got: ${statusValue}`);
    }
    if (!Array.isArray(record.findings)) {
        throw new Error('Validator output JSON missing findings array.');
    }
    const gaps = record.findings.map((finding) => formatFindingGap(finding)).filter(Boolean);
    const recommendations = Array.isArray(record.recommendations)
        ? record.recommendations.filter((item) => typeof item === 'string')
        : [];
    return {
        completeness: completenessValue,
        status: statusValue,
        gaps,
        recommendations
    };
}
function formatFindingGap(finding) {
    if (!finding || typeof finding !== 'object') {
        return '';
    }
    const record = finding;
    const requirement = typeof record.spec_requirement === 'string' ? record.spec_requirement.trim() : '';
    const gap = typeof record.gap_description === 'string' ? record.gap_description.trim() : '';
    const original = typeof record.original_code === 'string' ? record.original_code.trim() : '';
    const proposed = typeof record.proposed_diff === 'string' ? record.proposed_diff.trim() : '';
    const parts = [
        requirement ? `Requirement: ${requirement}` : '',
        gap ? `Gap: ${gap}` : '',
        original ? `Original: ${original}` : 'Original: (missing)',
        proposed ? `Proposed diff: ${proposed}` : 'Proposed diff: (missing)'
    ].filter(Boolean);
    return parts.join(' | ');
}
// Strict parsing enforced; missing fields should error out.
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
function buildLeadFallbacks(currentLead, availableTools) {
    const unique = [];
    const candidates = [currentLead, ...availableTools.filter((tool) => tool !== currentLead)];
    for (const tool of candidates) {
        if (!unique.includes(tool)) {
            unique.push(tool);
        }
    }
    return unique;
}
class LeadRateLimitError extends Error {
    tool;
    output;
    constructor(tool, output) {
        super(`Lead rate limit: ${tool}`);
        this.name = 'LeadRateLimitError';
        this.tool = tool;
        this.output = output;
    }
}
function isLeadRateLimitError(error) {
    return error instanceof LeadRateLimitError;
}
function isRateLimitMessage(message) {
    const lower = message.toLowerCase();
    return (lower.includes('limit reached') ||
        lower.includes('rate limit') ||
        lower.includes('quota') ||
        lower.includes('too many requests'));
}
function normalizeResumedRoles(session, availableTools) {
    const availableSet = new Set(availableTools);
    if (availableTools.length < 2) {
        throw new Error('At least 2 AI tools required');
    }
    let lead = session.lead;
    let changed = false;
    if (!availableSet.has(lead)) {
        const fallback = availableTools[0];
        lead = fallback;
        changed = true;
    }
    let validators = session.validators.filter((tool) => tool !== lead && availableSet.has(tool));
    if (validators.length === 0) {
        validators = availableTools.filter((tool) => tool !== lead);
        changed = true;
    }
    if (validators.length === 0) {
        throw new Error('At least 1 validator required');
    }
    if (lead !== session.lead || validators.length !== session.validators.length) {
        changed = true;
    }
    return { lead, validators, changed };
}
async function runLeadWithRetry(runner, tool, prompt, cwd, timeoutMs, logger) {
    const first = await runner.runLead(tool, prompt, cwd, timeoutMs);
    if (isRateLimitMessage(first.output)) {
        throw new LeadRateLimitError(tool, first.output);
    }
    if (first.exitCode === 0) {
        return first;
    }
    // Log first failure
    if (logger) {
        logger.warn({ tool, exitCode: first.exitCode, durationMs: first.durationMs }, `Lead execution failed (first attempt), retrying...`);
        if (first.output && first.output.trim().length > 0) {
            logger.warn({ tool, output: first.output.substring(0, 1000) }, 'First attempt error output');
        }
    }
    const second = await runner.runLead(tool, prompt, cwd, timeoutMs);
    if (isRateLimitMessage(second.output)) {
        throw new LeadRateLimitError(tool, second.output);
    }
    if (second.exitCode !== 0) {
        if (!second.output || second.output.trim().length === 0) {
            return second;
        }
        // Log second failure with full details
        if (logger) {
            logger.error({ tool, exitCode: second.exitCode, durationMs: second.durationMs }, 'Lead execution failed after retry');
            logger.error({ tool, output: second.output }, 'Error output from failed execution');
        }
        // Include error output in exception for visibility
        const errorPreview = second.output.length > 500
            ? second.output.substring(0, 500) + '...(truncated)'
            : second.output;
        throw new Error(`Lead execution failed after retry: ${tool}\n` +
            `Exit code: ${second.exitCode}\n` +
            `Error output:\n${errorPreview}`);
    }
    return second;
}
function buildValidationFeedback(validations) {
    const failing = validations.filter((validation) => validation.parsed.status === 'FAIL');
    if (failing.length === 0) {
        return '';
    }
    const lines = ['Validator gaps (detailed):'];
    for (const validation of failing) {
        if (validation.parsed.gaps.length === 0) {
            lines.push(`- ${validation.tool}: No gaps provided`);
            continue;
        }
        validation.parsed.gaps.forEach((gap) => {
            lines.push(`- ${validation.tool}: ${gap}`);
        });
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
function getToolThrottleMs(env) {
    if (env.AIC_TEST_MODE === '1' || env.NODE_ENV === 'test') {
        return 0;
    }
    const raw = env.AIC_TOOL_THROTTLE_MS;
    if (!raw) {
        return 2000;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 2000;
}
async function throttleToolCall(throttleMs, onThrottle, lastCallAt) {
    if (throttleMs <= 0) {
        return;
    }
    const elapsed = Date.now() - lastCallAt;
    const wait = throttleMs - elapsed;
    if (wait > 0) {
        await sleep(wait);
    }
    onThrottle();
}
async function sleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
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
    const totalCycleNumber = input.cycleNumber === 0
        ? input.totalCyclesBeforeRun
        : input.totalCyclesBeforeRun + input.cycleNumber;
    const totalCap = input.preflightTotalCap ?? input.session.config.maxIterations;
    const label = input.cycleNumber === 0
        ? `Preflight: Validators running for ${input.specEntry.file} (total ${totalCycleNumber}/${totalCap})`
        : `Cycle ${input.cycleNumber}/${input.currentRunIterations} (total ${totalCycleNumber}/${input.session.config.maxIterations}): Validators running for ${input.specEntry.file}`;
    validationSpinner.start(label);
    await ensureDir(getProjectReportsDir(input.cwd));
    const validations = [];
    for (const tool of input.roleAssignment.validators) {
        if (input.throttle) {
            await input.throttle();
        }
        if (input.options.verbose) {
            input.output.write(`[validator:${tool}] starting\n`);
        }
        let result = await input.runner.runValidator(tool, input.validationPrompt, input.cwd, input.timeoutMs);
        // Log if validator failed with non-zero exit code
        if (result.exitCode !== 0 && input.logger) {
            input.logger.warn({ tool, exitCode: result.exitCode, durationMs: result.durationMs }, 'Validator execution returned non-zero exit code');
            if (result.output && result.output.trim().length > 0) {
                input.logger.warn({ tool, output: result.output.substring(0, 1000) }, 'Validator error output');
            }
        }
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
            validations.push(validation);
            continue;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const shouldRetry = message.includes('Validator output')
                || message.includes('JSON')
                || message.includes('response_block');
            if (!shouldRetry) {
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
            if (input.throttle) {
                await input.throttle();
            }
            result = await input.runner.runValidator(tool, retryPrompt, input.cwd, input.timeoutMs);
            // Log if retry also failed with non-zero exit code
            if (result.exitCode !== 0 && input.logger) {
                input.logger.warn({ tool, exitCode: result.exitCode, durationMs: result.durationMs }, 'Validator retry execution returned non-zero exit code');
                if (result.output && result.output.trim().length > 0) {
                    input.logger.warn({ tool, output: result.output.substring(0, 1000) }, 'Validator retry error output');
                }
            }
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
                validations.push(validation);
                continue;
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
                validations.push({
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
                });
            }
        }
    }
    validationSpinner.stop();
    return validations;
}
function buildValidationRetryPrompt(prompt) {
    return `${prompt}\n\nFORMAT RECOVERY REQUIRED: Your previous response was invalid.
You MUST return ONLY a valid JSON object with NO additional text before or after.
The JSON must have exactly this structure:

{
  "response_block": {
    "completeness": <number from 0 to 100>,
    "status": "<exactly 'PASS' or 'FAIL'>",
    "findings": [
      {
        "spec_requirement": "<string>",
        "gap_description": "<string>",
        "original_code": "<string>",
        "proposed_diff": "<string>"
      }
    ],
    "recommendations": ["<string>"]
  }
}

Do not include markdown code blocks, explanatory text, or any content except the JSON object.`;
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
