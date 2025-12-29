import path from 'node:path';
import { getConfigFile } from './paths';
import { ensureDir, pathExists, readTextFile, writeTextFile } from '../utils/fs';

export interface GlobalConfig {
  defaultLead?: string;
  defaultMaxIterations?: number;
  defaultTimeout?: number;
}

export async function readGlobalConfig(env: NodeJS.ProcessEnv = process.env): Promise<GlobalConfig> {
  const configPath = getConfigFile(env);
  if (!(await pathExists(configPath))) {
    return {};
  }
  const content = await readTextFile(configPath);
  return JSON.parse(content) as GlobalConfig;
}

export async function writeGlobalConfig(config: GlobalConfig, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const configPath = getConfigFile(env);
  await ensureDir(path.dirname(configPath));
  await writeTextFile(configPath, JSON.stringify(config, null, 2));
}
