import pino from 'pino';
export declare function createLogger(sessionId: string, env?: NodeJS.ProcessEnv): Promise<pino.Logger<never, boolean>>;
