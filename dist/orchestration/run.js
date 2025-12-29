import path from 'node:path';
import fs from 'node:fs/promises';
import chalk from 'chalk';
import ora from 'ora';
import { DefaultToolRunner } from '../tools/runner.js';
import { assignRoles } from '../tools/roles.js';
import { detectTools } from '../tools/registry.js';
import { loadSpecs, orderSpecs } from '../specs/discovery.js';
import { createSession, persistSession, completeSession, loadSession } from './session.js';
import { getReportsDir, SPECS_DIR } from '../config/paths.js';
import { ensureDir, listFilesRecursive, writeTextFile } from '../utils/fs.js';
import { createLogger } from '../utils/logger.js';
export async function runCoordinator(options, context, deps = {}) {
    const cwd = context.cwd;
    const output = context.output;
    const errorOutput = context.errorOutput;
    const spinner = ora({ isEnabled: !options.quiet });
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
    if (lowMaturity.length > 0 && !options.quiet) {
        for (const spec of lowMaturity) {
            output.write(chalk.yellow(`Spec ${spec.file} maturity ${spec.meta.maturity} is below recommended minimum (3).\\n`));
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
                quiet: options.quiet
            },
            env: context.env
        });
    }
    const logger = await createLogger(session.id, context.env);
    logger.info({ sessionId: session.id }, 'Session started');
    const runner = deps.runner ?? new DefaultToolRunner();
    const contextDocs = orderedLoaded.filter((spec) => spec.entry.contextOnly).map((spec) => spec.content);
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
        for (let cycleNumber = 1; cycleNumber <= iterations; cycleNumber += 1) {
            const cycleStart = new Date().toISOString();
            const leadPrompt = buildLeadPrompt(specContent, contextDocs, validationFeedback, await summarizeCodebase(cwd));
            spinner.start(`Cycle ${cycleNumber}/${iterations}: Lead implementing ${specEntry.file}`);
            const leadResult = await runLeadWithRetry(runner, roleAssignment.lead, leadPrompt, cwd, options.timeout * 60_000);
            spinner.stop();
            logger.info({ cycle: cycleNumber, tool: roleAssignment.lead }, 'Lead execution completed');
            const validationPrompt = await buildValidationPrompt(specContent, contextDocs, cwd);
            const validationSpinner = ora({ isEnabled: !options.quiet });
            validationSpinner.start(`Cycle ${cycleNumber}/${iterations}: Validators running`);
            const validations = await Promise.all(roleAssignment.validators.map(async (tool) => {
                const result = await runner.runValidator(tool, validationPrompt, cwd, options.timeout * 60_000);
                return toValidation(tool, validationPrompt, result);
            }));
            validationSpinner.stop();
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
            if (consensusReached) {
                output.write(chalk.green(`Consensus reached for ${specEntry.file}.\n`));
                specEntry.status = 'completed';
                specEntry.completedAt = new Date().toISOString();
                await persistSession(session, context.env);
                break;
            }
            if (cycleNumber === iterations) {
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
function buildLeadPrompt(specContent, contextDocs, validationFeedback, codebaseSummary) {
    const contextSection = contextDocs.length > 0 ? `\nSYSTEM CONTEXT:\n${contextDocs.join('\n\n')}` : '';
    return `You are implementing a feature defined in the following specification.\n\nSPECIFICATION:\n${specContent}${contextSection}\n\nCURRENT CODEBASE STATE:\n${codebaseSummary}\n\nPREVIOUS VALIDATION FEEDBACK (if any):\n${validationFeedback}\n\nInstructions:\n1. Implement the requirements in the specification\n2. Follow the acceptance criteria precisely\n3. Address any gaps identified in previous validation feedback\n4. Explain significant implementation decisions`;
}
async function buildValidationPrompt(specContent, contextDocs, cwd) {
    const codebaseContent = await readCodebaseContent(cwd);
    const contextSection = contextDocs.length > 0 ? `\nSYSTEM CONTEXT:\n${contextDocs.join('\n\n')}` : '';
    return `You are validating an implementation against its specification.\n\nSPECIFICATION:\n${specContent}${contextSection}\n\nIMPLEMENTATION (current codebase):\n${codebaseContent}\n\nInstructions:\n1. Read the codebase thoroughly\n2. Compare implementation to each requirement in the spec\n3. Identify gaps, missing features, or deviations\n4. Rate implementation completeness (0-100%)\n5. List specific issues that must be addressed\n\nResponse Format:\nCOMPLETENESS: {percentage}%\nSTATUS: {PASS|FAIL}\nGAPS:\n- {gap_1}\n- {gap_2}\nRECOMMENDATIONS:\n- {recommendation_1}`;
}
async function readCodebaseContent(cwd) {
    const files = await listFilesRecursive(cwd, {
        excludeDirs: ['node_modules', 'dist', '.git', '.ai-coord', 'specs'],
        limit: 100
    });
    const chunks = [];
    for (const file of files) {
        const stat = await fs.stat(file);
        if (stat.size > 50_000) {
            continue;
        }
        const content = await fs.readFile(file, 'utf8');
        chunks.push(`# ${path.relative(cwd, file)}\n${content}`);
    }
    return chunks.join('\n\n');
}
function toValidation(tool, prompt, result) {
    return {
        tool: tool,
        prompt,
        output: result.output,
        parsed: parseValidationOutput(result.output),
        durationMs: result.durationMs,
        exitCode: result.exitCode
    };
}
export function parseValidationOutput(output) {
    const completenessMatch = output.match(/COMPLETENESS:\s*(\d+)%/i);
    const statusMatch = output.match(/STATUS:\s*(PASS|FAIL)/i);
    const completeness = completenessMatch ? Number(completenessMatch[1]) : 0;
    const status = statusMatch ? statusMatch[1].toUpperCase() : 'FAIL';
    const gaps = extractBullets(output, 'GAPS:');
    const recommendations = extractBullets(output, 'RECOMMENDATIONS:');
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
    const reportsDir = getReportsDir(env);
    await ensureDir(reportsDir);
    const reportPath = path.join(reportsDir, `${session.id}-report.md`);
    const lines = [`# AI Spec Coordinator Report`, '', `Session: ${session.id}`, `Status: ${session.status}`, ''];
    lines.push(`Lead: ${session.lead}`);
    lines.push(`Validators: ${session.validators.join(', ')}`);
    lines.push('');
    lines.push('## Specs');
    for (const spec of session.specs) {
        lines.push(`- ${spec.meta.name} (${spec.file}): ${spec.status}`);
    }
    lines.push('');
    await writeTextFile(reportPath, lines.join('\n'));
}
