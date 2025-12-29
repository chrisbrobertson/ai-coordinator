export declare function ensureDir(dir: string): Promise<void>;
export declare function pathExists(target: string): Promise<boolean>;
export declare function readTextFile(filePath: string): Promise<string>;
export declare function writeTextFile(filePath: string, content: string): Promise<void>;
export declare function listFilesRecursive(root: string, options?: {
    excludeDirs?: string[];
    limit?: number;
}): Promise<string[]>;
export declare function removePath(target: string): Promise<void>;
