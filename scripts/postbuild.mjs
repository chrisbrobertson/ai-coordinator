import fs from 'node:fs/promises';
import path from 'node:path';

const target = path.join(process.cwd(), 'dist', 'cli', 'index.js');
const shebang = '#!/usr/bin/env node\n';

try {
  const content = await fs.readFile(target, 'utf8');
  if (!content.startsWith(shebang)) {
    await fs.writeFile(target, `${shebang}${content}`, 'utf8');
  }
} catch (error) {
  console.error(`postbuild: unable to update ${target}:`, error);
  process.exitCode = 1;
}
