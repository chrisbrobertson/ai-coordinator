import path from 'node:path';
import os from 'node:os';
export const PROJECT_LINK_FILE = '.ai-coord';
export const SPECS_DIR = 'specs';
export function getStateDir(env = process.env) {
    if (env.AIC_STATE_DIR && env.AIC_STATE_DIR.trim()) {
        return env.AIC_STATE_DIR.trim();
    }
    return path.join(os.homedir(), '.ai-spec-coordinator');
}
export function getSessionsDir(env = process.env) {
    return path.join(getStateDir(env), 'sessions');
}
export function getReportsDir(env = process.env) {
    return path.join(getStateDir(env), 'reports');
}
export function getLogsDir(env = process.env) {
    return path.join(getStateDir(env), 'logs');
}
export function getConfigFile(env = process.env) {
    return path.join(getStateDir(env), 'config.json');
}
