import path from 'node:path';
import { getConfigFile } from './paths.js';
import { ensureDir, pathExists, readTextFile, writeTextFile } from '../utils/fs.js';
export async function readGlobalConfig(env = process.env) {
    const configPath = getConfigFile(env);
    if (!(await pathExists(configPath))) {
        return {};
    }
    const content = await readTextFile(configPath);
    return JSON.parse(content);
}
export async function writeGlobalConfig(config, env = process.env) {
    const configPath = getConfigFile(env);
    await ensureDir(path.dirname(configPath));
    await writeTextFile(configPath, JSON.stringify(config, null, 2));
}
