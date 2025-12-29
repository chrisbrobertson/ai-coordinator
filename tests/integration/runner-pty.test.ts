import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { DefaultToolRunner } from '../../src/tools/runner.js';
import { createTempDir, makeExecutable } from '../helpers';


describe('DefaultToolRunner pseudo-tty wrapper', () => {
  let originalPath: string | undefined;
  let originalIsTty: boolean | undefined;

  beforeEach(() => {
    originalPath = process.env.PATH;
    originalIsTty = process.stdout.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
  });

  afterEach(() => {
    if (originalPath !== undefined) {
      process.env.PATH = originalPath;
    }
    if (originalIsTty !== undefined) {
      Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTty, configurable: true });
    }
  });

  it('wraps codex with script when stdout is not a TTY', async () => {
    const binDir = await createTempDir('aic-bin-');
    const logDir = await createTempDir('aic-log-');
    const logFile = path.join(logDir, 'script.log');

    const scriptShim = `#!/bin/sh\n"${process.execPath}" -e "require('fs').appendFileSync(process.env.SCRIPT_LOG, process.argv.slice(2).join(' ') + '\\n')"; echo script-called; exit 0\n`;
    const codexShim = `#!/bin/sh\necho codex-called\nexit 0\n`;
    await makeExecutable(path.join(binDir, 'script'), scriptShim);
    await makeExecutable(path.join(binDir, 'codex'), codexShim);

    process.env.PATH = `${binDir}:${process.env.PATH}`;
    process.env.SCRIPT_LOG = logFile;

    const runner = new DefaultToolRunner({
      interactive: false,
      leadPermissions: undefined,
      sandbox: false,
      sandboxImage: 'node:20',
      verbose: false,
      output: process.stdout,
      inheritStdin: false
    });

    const result = await runner.runValidator('codex', 'prompt', binDir, 5000);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('script-called');

    // script shim output confirms pseudo-tty wrapper was used
  });
});
