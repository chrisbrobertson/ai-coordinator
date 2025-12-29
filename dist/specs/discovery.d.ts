import { SpecEntry } from '../types.js';
export interface SpecDiscoveryOptions {
    include?: string[];
    exclude?: string[];
}
export interface LoadedSpec {
    entry: SpecEntry;
    content: string;
}
export declare function discoverSpecFiles(specsDir: string, options?: SpecDiscoveryOptions): Promise<string[]>;
export declare function loadSpec(filePath: string): Promise<LoadedSpec | null>;
export declare function loadSpecs(specsDir: string, options?: SpecDiscoveryOptions): Promise<LoadedSpec[]>;
export declare function orderSpecs(specs: SpecEntry[]): SpecEntry[];
