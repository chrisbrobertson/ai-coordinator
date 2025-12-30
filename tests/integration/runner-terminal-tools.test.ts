import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { DefaultToolRunner } from '../../src/tools/runner';
import { createTempDir, makeExecutable } from '../helpers';


describe('DefaultToolRunner terminal handling', () => {
  let originalPath: string | undefined;

  beforeEach(() => {
    originalPath = process.env.PATH;
  });

  afterEach(() => {
    if (originalPath !== undefined) {
      process.env.PATH = originalPath;
    }
  });

  it('runs codex exec directly and leaves claude direct', async () => {
    const binDir = await createTempDir('aic-bin-');

    const scriptShim = `#!/bin/sh\necho script-called\nexit 0\n`;
    const codexShim = `#!/bin/sh\necho codex-called\nexit 0\n`;
    const claudeShim = `#!/bin/sh\necho claude-called\nexit 0\n`;

    await makeExecutable(path.join(binDir, 'script'), scriptShim);
    await makeExecutable(path.join(binDir, 'codex'), codexShim);
    await makeExecutable(path.join(binDir, 'claude'), claudeShim);

    process.env.PATH = `${binDir}:${process.env.PATH}`;

    const runner = new DefaultToolRunner({
      interactive: false,
      leadPermissions: undefined,
      sandbox: false,
      sandboxImage: 'node:20',
      verbose: false,
      output: process.stdout,
      inheritStdin: false
    });

    const codexResult = await runner.runValidator('codex', 'prompt', binDir, 5000);
    expect(codexResult.output).toContain('codex-called');

    const claudeResult = await runner.runValidator('claude', 'prompt', binDir, 5000);
    expect(claudeResult.output).toContain('claude-called');
  });
});
