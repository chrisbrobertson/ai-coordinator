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

  it('parses response blocks wrapped in JSON', () => {
    const output = JSON.stringify({
      response_block: 'COMPLETENESS: 80%\nSTATUS: FAIL\nGAPS:\n- Gap\nRECOMMENDATIONS:\n- Fix'
    });
    const parsed = parseValidationOutput(output);
    expect(parsed.completeness).toBe(80);
    expect(parsed.status).toBe('FAIL');
    expect(parsed.gaps).toEqual(['Gap']);
  });

  it('computes consensus rules', () => {
    const pass = { completeness: 100, status: 'PASS', gaps: [], recommendations: [] };
    const fail = { completeness: 50, status: 'FAIL', gaps: ['gap'], recommendations: [] };
    expect(hasConsensus([pass])).toBe(true);
    expect(hasConsensus([pass, pass])).toBe(true);
    expect(hasConsensus([pass, fail])).toBe(false);
    expect(hasConsensus([pass, fail, pass])).toBe(true);
  });

  it('throws when status line is missing', () => {
    const output = `COMPLETENESS: 100%\nGAPS:\n- None\nRECOMMENDATIONS:\n- None`;
    expect(() => parseValidationOutput(output)).toThrow(/response format/i);
  });

  it('throws when completeness line is missing', () => {
    const output = `STATUS: PASS\nGAPS:\n- None\nRECOMMENDATIONS:\n- None`;
    expect(() => parseValidationOutput(output)).toThrow(/response format/i);
  });
});
