import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { runCli } from '../../src/cli/cli';
import { createTempDir, createOutputBuffer } from '../helpers';


describe('cli init', () => {
  it('creates specs directory and example file', async () => {
    const projectDir = await createTempDir('aic-cli-');
    const out = createOutputBuffer();
    const err = createOutputBuffer();

    await runCli({
      argv: ['init'],
      cwd: projectDir,
      stdout: out.stream,
      stderr: err.stream
    });

    const specsDir = path.join(projectDir, 'specs');
    const exists = await fs.stat(specsDir).then(() => true).catch(() => false);
    expect(exists).toBe(true);
    const examplePath = path.join(specsDir, 'example-feature.md');
    const example = await fs.readFile(examplePath, 'utf8');
    expect(example).toContain('Example Feature');
  });
});
