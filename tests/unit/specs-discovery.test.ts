import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { loadSpec, orderSpecs } from '../../src/specs/discovery';
import { createTempDir } from '../helpers';
import { SpecEntry } from '../../src/types';

const validSpec = `---
specmas: v3
kind: FeatureSpec
id: feat-auth
name: Auth
version: 1.0.0
complexity: MODERATE
maturity: 3
depends_on: [feat-core]
---
# Auth`;

const coreSpec = `---
specmas: v3
kind: FeatureSpec
id: feat-core
name: Core
version: 1.0.0
complexity: EASY
maturity: 3
---
# Core`;

const invalidSpec = `# Missing front matter`;

describe('spec discovery', () => {
  it('loads valid specs and ignores invalid ones', async () => {
    const dir = await createTempDir('specs-');
    const file = path.join(dir, 'feat-auth.md');
    const invalid = path.join(dir, 'invalid.md');
    await fs.writeFile(file, validSpec, 'utf8');
    await fs.writeFile(invalid, invalidSpec, 'utf8');

    const loaded = await loadSpec(file);
    const invalidLoaded = await loadSpec(invalid);

    expect(loaded?.entry.meta.id).toBe('feat-auth');
    expect(invalidLoaded).toBeNull();
  });

  it('orders specs by dependencies', () => {
    const specs: SpecEntry[] = [
      {
        file: 'feat-auth.md',
        path: '/tmp/feat-auth.md',
        meta: { id: 'feat-auth', name: 'Auth', complexity: 'MODERATE', maturity: 3, dependsOn: ['feat-core'] },
        status: 'pending',
        cycles: []
      },
      {
        file: 'feat-core.md',
        path: '/tmp/feat-core.md',
        meta: { id: 'feat-core', name: 'Core', complexity: 'EASY', maturity: 3 },
        status: 'pending',
        cycles: []
      }
    ];

    const ordered = orderSpecs(specs);
    expect(ordered[0].meta.id).toBe('feat-core');
    expect(ordered[1].meta.id).toBe('feat-auth');
  });

  it('orders system specs before feature specs', () => {
    const systemSpec: SpecEntry = {
      file: 'system-architecture.md',
      path: '/tmp/system-architecture.md',
      meta: { id: 'system-architecture', name: 'System', complexity: 'MODERATE', maturity: 3 },
      status: 'pending',
      cycles: [],
      contextOnly: true
    };
    const featureSpec: SpecEntry = {
      file: 'feat-core.md',
      path: '/tmp/feat-core.md',
      meta: { id: 'feat-core', name: 'Core', complexity: 'EASY', maturity: 3 },
      status: 'pending',
      cycles: []
    };

    const ordered = orderSpecs([featureSpec, systemSpec]);
    expect(ordered[0].file).toBe('system-architecture.md');
  });
});
