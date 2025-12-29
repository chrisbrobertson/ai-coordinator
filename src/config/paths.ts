import path from 'node:path';
import os from 'node:os';

export const PROJECT_STATE_DIR = '.ai-coord';
export const PROJECT_SESSION_FILE = path.join(PROJECT_STATE_DIR, 'session');
export const SPECS_DIR = 'specs';

export function getProjectStateDir(cwd: string): string {
  return path.join(cwd, PROJECT_STATE_DIR);
}

export function getProjectSessionsDir(cwd: string): string {
  return path.join(getProjectStateDir(cwd), 'sessions');
}

export function getProjectReportsDir(cwd: string): string {
  return path.join(getProjectStateDir(cwd), 'reports');
}

export function getProjectLogsDir(cwd: string): string {
  return path.join(getProjectStateDir(cwd), 'logs');
}

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
