import { Session, SessionConfig, SpecEntry, ToolName } from '../types.js';
export interface CreateSessionOptions {
    cwd: string;
    specs: SpecEntry[];
    lead: ToolName;
    validators: ToolName[];
    config: SessionConfig;
    env?: NodeJS.ProcessEnv;
}
export declare function createSession(options: CreateSessionOptions): Promise<Session>;
export declare function persistSession(session: Session, env?: NodeJS.ProcessEnv): Promise<void>;
export declare function loadSession(cwd: string, env?: NodeJS.ProcessEnv): Promise<Session | null>;
export declare function loadSessionById(cwd: string, sessionId: string, env?: NodeJS.ProcessEnv): Promise<Session | null>;
export declare function completeSession(session: Session, env?: NodeJS.ProcessEnv): Promise<void>;
