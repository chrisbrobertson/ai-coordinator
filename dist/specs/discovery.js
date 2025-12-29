import path from 'node:path';
import fs from 'node:fs/promises';
import { Minimatch } from 'minimatch';
import YAML from 'yaml';
import { readTextFile } from '../utils/fs.js';
export async function discoverSpecFiles(specsDir, options) {
    const exists = await fs
        .access(specsDir)
        .then(() => true)
        .catch(() => false);
    if (!exists) {
        return [];
    }
    const entries = await fs.readdir(specsDir, { withFileTypes: true });
    let files = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => entry.name);
    if (options?.include && options.include.length > 0) {
        const matchers = options.include.map((pattern) => new Minimatch(pattern));
        files = files.filter((file) => matchers.some((matcher) => matcher.match(file)));
    }
    if (options?.exclude && options.exclude.length > 0) {
        const matchers = options.exclude.map((pattern) => new Minimatch(pattern));
        files = files.filter((file) => !matchers.some((matcher) => matcher.match(file)));
    }
    return files.map((file) => path.join(specsDir, file));
}
export async function loadSpec(filePath) {
    const content = await readTextFile(filePath);
    const frontMatter = extractFrontMatter(content);
    if (!frontMatter) {
        return null;
    }
    const metadata = parseSpecMetadata(frontMatter);
    if (!metadata) {
        return null;
    }
    const file = path.basename(filePath);
    const entry = {
        file,
        path: filePath,
        meta: metadata,
        status: 'pending',
        cycles: []
    };
    if (file.startsWith('system-')) {
        entry.contextOnly = true;
    }
    return { entry, content };
}
export async function loadSpecs(specsDir, options) {
    const files = await discoverSpecFiles(specsDir, options);
    const loaded = [];
    for (const file of files) {
        const spec = await loadSpec(file);
        if (spec) {
            loaded.push(spec);
        }
    }
    return loaded;
}
export function orderSpecs(specs) {
    const systemSpecs = specs.filter((spec) => spec.contextOnly).sort((a, b) => a.file.localeCompare(b.file));
    const featureSpecs = specs.filter((spec) => !spec.contextOnly);
    const byId = new Map();
    for (const spec of featureSpecs) {
        byId.set(spec.meta.id, spec);
    }
    const incoming = new Map();
    const outgoing = new Map();
    for (const spec of featureSpecs) {
        const deps = spec.meta.dependsOn ?? [];
        for (const dep of deps) {
            if (!byId.has(dep)) {
                throw new Error(`Spec dependency not found: ${dep}`);
            }
        }
        incoming.set(spec.meta.id, deps.length);
        outgoing.set(spec.meta.id, []);
    }
    for (const spec of featureSpecs) {
        const deps = spec.meta.dependsOn ?? [];
        for (const dep of deps) {
            outgoing.get(dep)?.push(spec.meta.id);
        }
    }
    const queue = [...featureSpecs]
        .filter((spec) => (incoming.get(spec.meta.id) ?? 0) === 0)
        .sort((a, b) => a.file.localeCompare(b.file));
    const ordered = [];
    while (queue.length > 0) {
        const spec = queue.shift();
        if (!spec) {
            break;
        }
        ordered.push(spec);
        const edges = outgoing.get(spec.meta.id) ?? [];
        for (const id of edges) {
            const current = (incoming.get(id) ?? 0) - 1;
            incoming.set(id, current);
            if (current === 0) {
                const next = byId.get(id);
                if (next) {
                    queue.push(next);
                    queue.sort((a, b) => a.file.localeCompare(b.file));
                }
            }
        }
    }
    if (ordered.length !== featureSpecs.length) {
        throw new Error('Spec dependency cycle detected');
    }
    return [...systemSpecs, ...ordered];
}
function extractFrontMatter(content) {
    if (!content.startsWith('---')) {
        return null;
    }
    const endIndex = content.indexOf('\n---', 3);
    if (endIndex === -1) {
        return null;
    }
    return content.slice(3, endIndex).trim();
}
function parseSpecMetadata(frontMatter) {
    try {
        const data = YAML.parse(frontMatter);
        if (!data || typeof data !== 'object') {
            return null;
        }
        if (!data.specmas || !data.kind || !data.id || !data.name || !data.complexity || !data.maturity) {
            return null;
        }
        const depends = data.depends_on ?? data.dependsOn;
        let dependsOn;
        if (Array.isArray(depends)) {
            dependsOn = depends.map((value) => String(value));
        }
        else if (typeof depends === 'string') {
            dependsOn = [depends];
        }
        const metadata = {
            id: String(data.id),
            name: String(data.name),
            complexity: normalizeComplexity(String(data.complexity)),
            maturity: Number(data.maturity),
            dependsOn
        };
        return metadata;
    }
    catch {
        return null;
    }
}
function normalizeComplexity(value) {
    const normalized = value.toUpperCase();
    if (normalized === 'EASY' || normalized === 'MODERATE' || normalized === 'HIGH') {
        return normalized;
    }
    return 'MODERATE';
}
