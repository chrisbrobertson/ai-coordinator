export interface GlobalConfig {
    defaultLead?: string;
    defaultMaxIterations?: number;
    defaultTimeout?: number;
}
export declare function readGlobalConfig(env?: NodeJS.ProcessEnv): Promise<GlobalConfig>;
export declare function writeGlobalConfig(config: GlobalConfig, env?: NodeJS.ProcessEnv): Promise<void>;
