import fs from 'node:fs/promises';
import path from 'node:path';
export async function ensureDir(dir) {
    await fs.mkdir(dir, { recursive: true });
}
export async function pathExists(target) {
    try {
        await fs.access(target);
        return true;
    }
    catch {
        return false;
    }
}
export async function readTextFile(filePath) {
    return fs.readFile(filePath, 'utf8');
}
export async function writeTextFile(filePath, content) {
    await ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, content, 'utf8');
}
export async function listFilesRecursive(root, options) {
    const exclude = new Set(options?.excludeDirs ?? []);
    const results = [];
    const limit = options?.limit ?? Infinity;
    async function walk(current) {
        if (results.length >= limit) {
            return;
        }
        const entries = await fs.readdir(current, { withFileTypes: true });
        for (const entry of entries) {
            if (results.length >= limit) {
                break;
            }
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (!exclude.has(entry.name)) {
                    await walk(fullPath);
                }
            }
            else {
                results.push(fullPath);
            }
        }
    }
    await walk(root);
    return results;
}
export async function removePath(target) {
    await fs.rm(target, { recursive: true, force: true });
}
