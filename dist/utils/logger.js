import pino from 'pino';
import { getLogsDir } from '../config/paths.js';
import path from 'node:path';
import { ensureDir } from './fs.js';
export async function createLogger(sessionId, env = process.env) {
    const logsDir = getLogsDir(env);
    await ensureDir(logsDir);
    const logPath = path.join(logsDir, `${sessionId}.log`);
    return pino({
        level: env.AIC_LOG_LEVEL ?? 'info',
        timestamp: pino.stdTimeFunctions.isoTime
    }, pino.destination(logPath));
}
