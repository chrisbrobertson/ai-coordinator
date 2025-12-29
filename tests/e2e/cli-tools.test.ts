import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { runCli } from '../../src/cli/cli';
import { createTempDir, createOutputBuffer, makeExecutable } from '../helpers';


describe('cli tools', () => {
  it('lists available tools', async () => {
    const binDir = await createTempDir('aic-bin-');
    const fakeTool = `#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo \"tool 1.0.0\"\n  exit 0\nfi\nexit 0\n`;
    await makeExecutable(path.join(binDir, 'claude'), fakeTool);
    await makeExecutable(path.join(binDir, 'codex'), fakeTool);

    const out = createOutputBuffer();
    const err = createOutputBuffer();

    await runCli({
      argv: ['tools'],
      stdout: out.stream,
      stderr: err.stream,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`
      }
    });

    expect(out.output).toContain('claude');
    expect(out.output).toContain('codex');
  });
});
