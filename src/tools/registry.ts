import fs from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { ToolInfo, ToolName, ToolRegistry } from '../types.js';
import { TOOL_DEFINITIONS } from './tool-definitions.js';

export async function detectTools(env: NodeJS.ProcessEnv = process.env): Promise<ToolRegistry> {
  const available = new Map<ToolName, ToolInfo>();
  for (const tool of TOOL_DEFINITIONS) {
    const resolved = await resolveOnPath(tool.command, env);
    if (!resolved) {
      continue;
    }
    const version = await detectVersion(tool.command, env);
    available.set(tool.name, {
      name: tool.name,
      command: tool.command,
      version: version ?? '-',
      path: resolved
    });
  }
  return { available };
}

export function getDefaultLeadOrder(): ToolName[] {
  return ['claude', 'codex', 'gemini'];
}

async function resolveOnPath(command: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  const pathEnv = env.PATH ?? '';
  const parts = pathEnv.split(path.delimiter).filter(Boolean);
  for (const dir of parts) {
    const candidate = path.join(dir, command);
    try {
      await fs.access(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

async function detectVersion(command: string, env: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    const { stdout } = await execa(command, ['--version'], { env });
    const line = stdout.trim().split('\n')[0];
    return line || null;
  } catch {
    return null;
  }
}
