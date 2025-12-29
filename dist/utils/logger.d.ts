import pino from 'pino';
export declare function createLogger(sessionId: string, cwd: string): Promise<pino.Logger<never, boolean>>;
