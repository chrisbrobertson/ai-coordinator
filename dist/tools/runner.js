import { execa } from 'execa';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getToolDefinition } from './tool-definitions.js';
export class DefaultToolRunner {
    config;
    constructor(config) {
        this.config = config;
    }
    async runLead(tool, prompt, cwd, timeoutMs) {
        const definition = getToolDefinition(tool);
        const args = this.buildLeadArgs(definition, prompt);
        const result = await this.execute(definition.command, args, cwd, timeoutMs);
        if (shouldRetryWithoutOutputFormat(definition.name, result.output)) {
            if (this.config.onWarning) {
                this.config.onWarning(`${definition.name} does not support --output-format; retrying without JSON output flags.`);
            }
            return this.execute(definition.command, stripOutputFormatArgs(args), cwd, timeoutMs);
        }
        return result;
    }
    async runValidator(tool, prompt, cwd, timeoutMs) {
        const definition = getToolDefinition(tool);
        const args = this.buildValidatorArgs(definition, prompt);
        const result = await this.execute(definition.command, args, cwd, timeoutMs);
        if (shouldRetryWithoutOutputFormat(definition.name, result.output)) {
            if (this.config.onWarning) {
                this.config.onWarning(`${definition.name} does not support --output-format; retrying without JSON output flags.`);
            }
            return this.execute(definition.command, stripOutputFormatArgs(args), cwd, timeoutMs);
        }
        if (result.exitCode === 0 || this.config.interactive) {
            return result;
        }
        if (!shouldRetryWithoutReadOnly(definition.name, result.output)) {
            return result;
        }
        if (this.config.onWarning) {
            this.config.onWarning(`Validator ${definition.name} did not accept read-only flags; falling back to full permissions.`);
        }
        return this.execute(definition.command, [prompt], cwd, timeoutMs);
    }
    async execute(command, args, cwd, timeoutMs) {
        const startedAt = Date.now();
        let streamed = false;
        try {
            const isCodexExec = command === 'codex' && args[0] === 'exec';
            const needsTtyStdin = (command === 'codex' || command === 'cortex')
                && !this.config.sandbox
                && process.stdin.isTTY;
            const stdinMode = this.config.inheritStdin || needsTtyStdin ? 'inherit' : 'ignore';
            const stdio = { stdin: stdinMode };
            let outputFile = null;
            let schemaFile = null;
            let execArgs = args;
            if (isCodexExec) {
                const prompt = args[args.length - 1] ?? '';
                schemaFile = path.join(os.tmpdir(), `aic-codex-schema-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
                outputFile = path.join(os.tmpdir(), `aic-codex-output-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
                const baseArgs = args.slice(0, -1);
                const schema = {
                    type: 'object',
                    properties: {
                        response_block: {
                            type: 'object',
                            properties: {
                                completeness: { type: 'number' },
                                status: { type: 'string', enum: ['PASS', 'FAIL'] },
                                findings: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            spec_requirement: { type: 'string' },
                                            gap_description: { type: 'string' },
                                            original_code: { type: 'string' },
                                            proposed_diff: { type: 'string' }
                                        },
                                        required: ['spec_requirement', 'gap_description', 'original_code', 'proposed_diff']
                                    }
                                },
                                recommendations: {
                                    type: 'array',
                                    items: { type: 'string' }
                                }
                            },
                            required: ['completeness', 'status', 'findings', 'recommendations']
                        }
                    },
                    required: ['response_block'],
                    additionalProperties: false
                };
                await fs.writeFile(schemaFile, JSON.stringify(schema), 'utf8');
                execArgs = [
                    ...baseArgs,
                    ...(baseArgs.includes('--json') ? [] : ['--json']),
                    ...(baseArgs.includes('--output-schema') ? [] : ['--output-schema', schemaFile]),
                    ...(baseArgs.includes('--output-last-message') ? [] : ['--output-last-message', outputFile]),
                    prompt
                ];
            }
            const dockerArgs = this.config.sandbox
                ? [
                    'run',
                    '--rm',
                    ...(this.config.inheritStdin ? ['-i'] : []),
                    ...(this.config.inheritStdin && process.stdin.isTTY ? ['-t'] : []),
                    '-v',
                    `${cwd}:/workspace`,
                    '-w',
                    '/workspace',
                    this.config.sandboxImage,
                    command,
                    ...execArgs
                ]
                : null;
            const finalCommand = this.config.sandbox ? 'docker' : command;
            const finalArgs = this.config.sandbox ? (dockerArgs ?? []) : execArgs;
            const execEnv = this.config.env ?? process.env;
            const toolHome = resolveToolHome(execEnv, cwd);
            if (toolHome) {
                await fs.mkdir(toolHome, { recursive: true });
            }
            const baseEnv = isCodexExec
                ? { ...execEnv, TERM: 'dumb', NO_COLOR: '1', CLICOLOR: '0' }
                : execEnv;
            const env = toolHome
                ? { ...baseEnv, HOME: toolHome, USERPROFILE: toolHome }
                : baseEnv;
            const subprocess = execa(finalCommand, finalArgs, {
                cwd,
                timeout: timeoutMs,
                reject: false,
                env,
                ...stdio
            });
            if (this.config.onSpawn) {
                this.config.onSpawn({ child: subprocess, command: finalCommand, args: finalArgs });
            }
            let stdout = '';
            let stderr = '';
            if (subprocess.stdout) {
                subprocess.stdout.on('data', (chunk) => {
                    const text = chunk.toString();
                    stdout += text;
                    if (this.config.verbose) {
                        streamed = true;
                        this.config.output.write(text);
                    }
                });
            }
            if (subprocess.stderr) {
                subprocess.stderr.on('data', (chunk) => {
                    const text = chunk.toString();
                    stderr += text;
                    if (this.config.verbose) {
                        streamed = true;
                        this.config.output.write(text);
                    }
                });
            }
            const result = await subprocess;
            const durationMs = Date.now() - startedAt;
            let combined = [stdout || result.stdout, stderr || result.stderr].filter(Boolean).join('\n');
            if (outputFile) {
                try {
                    const fileOutput = await fs.readFile(outputFile, 'utf8');
                    if (fileOutput.trim()) {
                        combined = fileOutput.trim();
                    }
                }
                catch {
                    // Fall back to captured output.
                }
                finally {
                    await fs.rm(outputFile, { force: true });
                }
            }
            if (schemaFile) {
                await fs.rm(schemaFile, { force: true });
            }
            return { output: combined, exitCode: result.exitCode ?? 0, durationMs, streamed };
        }
        catch (error) {
            const durationMs = Date.now() - startedAt;
            const output = error instanceof Error ? error.message : 'Unknown error';
            return { output, exitCode: 1, durationMs, streamed };
        }
    }
    buildLeadArgs(definition, prompt) {
        if (this.config.interactive) {
            return [prompt];
        }
        if (definition.name === 'claude' && this.config.leadPermissions && this.config.leadPermissions.length > 0) {
            return [
                '--allowedTools',
                this.config.leadPermissions.join(','),
                '-p',
                prompt,
                '--output-format',
                'json'
            ];
        }
        if (definition.name !== 'claude' && this.config.leadPermissions && this.config.onWarning) {
            this.config.onWarning(`Lead permissions override is not supported for ${definition.name}; using default permissions.`);
        }
        return [...definition.leadArgs, prompt];
    }
    buildValidatorArgs(definition, prompt) {
        if (this.config.interactive) {
            return [prompt];
        }
        return [...definition.validatorArgs, prompt];
    }
}
function shouldRetryWithoutOutputFormat(tool, output) {
    if (tool !== 'claude' && tool !== 'gemini') {
        return false;
    }
    const lower = output.toLowerCase();
    return lower.includes('--output-format')
        && (lower.includes('unknown option')
            || lower.includes('unrecognized option')
            || lower.includes('invalid option')
            || lower.includes('unknown flag')
            || lower.includes('unrecognized flag'));
}
function shouldRetryWithoutReadOnly(tool, output) {
    if (tool !== 'claude' && tool !== 'gemini') {
        return false;
    }
    const lower = output.toLowerCase();
    const readOnlyFlag = tool === 'claude' ? '--allowedtools' : '--read-only';
    return lower.includes(readOnlyFlag)
        && (lower.includes('unknown option')
            || lower.includes('unrecognized option')
            || lower.includes('invalid option')
            || lower.includes('unknown flag')
            || lower.includes('unrecognized flag'));
}
function stripOutputFormatArgs(args) {
    const cleaned = [];
    for (let i = 0; i < args.length; i += 1) {
        const value = args[i];
        if (value === '--output-format') {
            i += 1;
            continue;
        }
        cleaned.push(value);
    }
    return cleaned;
}
function resolveToolHome(env, cwd) {
    if (env.AIC_TOOL_HOME && env.AIC_TOOL_HOME.trim()) {
        return env.AIC_TOOL_HOME.trim();
    }
    if (env.AIC_TEST_MODE === '1') {
        return path.join(cwd, '.ai-coord', 'tool-home');
    }
    return null;
}
