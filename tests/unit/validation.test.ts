import { describe, it, expect } from 'vitest';
import { hasConsensus, parseValidationOutput } from '../../src/orchestration/run';


describe('validation parsing', () => {
  it('parses validation output', () => {
    const output = `COMPLETENESS: 90%\nSTATUS: PASS\nGAPS:\n- Missing tests\nRECOMMENDATIONS:\n- Add coverage`;
    const parsed = parseValidationOutput(output);
    expect(parsed.completeness).toBe(90);
    expect(parsed.status).toBe('PASS');
    expect(parsed.gaps).toEqual(['Missing tests']);
  });

  it('computes consensus rules', () => {
    const pass = { completeness: 100, status: 'PASS', gaps: [], recommendations: [] };
    const fail = { completeness: 50, status: 'FAIL', gaps: ['gap'], recommendations: [] };
    expect(hasConsensus([pass])).toBe(true);
    expect(hasConsensus([pass, pass])).toBe(true);
    expect(hasConsensus([pass, fail])).toBe(false);
    expect(hasConsensus([pass, fail, pass])).toBe(true);
  });
});
