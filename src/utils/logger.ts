import pino from 'pino';
import { getProjectLogsDir } from '../config/paths.js';
import path from 'node:path';
import { ensureDir } from './fs.js';

export async function createLogger(sessionId: string, cwd: string) {
  const logsDir = getProjectLogsDir(cwd);
  await ensureDir(logsDir);
  const logPath = path.join(logsDir, `${sessionId}.log`);
  return pino(
    {
      level: process.env.AIC_LOG_LEVEL ?? 'info',
      timestamp: pino.stdTimeFunctions.isoTime
    },
    pino.destination(logPath)
  );
}
