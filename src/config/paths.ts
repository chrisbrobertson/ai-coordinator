import path from 'node:path';
import os from 'node:os';

export const PROJECT_LINK_FILE = '.ai-coord';
export const SPECS_DIR = 'specs';

export function getStateDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AIC_STATE_DIR && env.AIC_STATE_DIR.trim()) {
    return env.AIC_STATE_DIR.trim();
  }
  return path.join(os.homedir(), '.ai-spec-coordinator');
}

export function getSessionsDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(getStateDir(env), 'sessions');
}

export function getReportsDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(getStateDir(env), 'reports');
}

export function getLogsDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(getStateDir(env), 'logs');
}

export function getConfigFile(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(getStateDir(env), 'config.json');
}
