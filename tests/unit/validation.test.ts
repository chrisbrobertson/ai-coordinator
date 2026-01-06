import { describe, it, expect } from 'vitest';
import { hasConsensus, parseValidationOutput } from '../../src/orchestration/run';


describe('validation parsing', () => {
  it('parses validation output', () => {
    const output = JSON.stringify({
      response_block: {
        completeness: 90,
        status: 'PASS',
        findings: [],
        recommendations: ['Add coverage']
      }
    });
    const parsed = parseValidationOutput(output);
    expect(parsed.completeness).toBe(90);
    expect(parsed.status).toBe('PASS');
    expect(parsed.gaps).toEqual([]);
  });

  it('parses structured response JSON', () => {
    const output = JSON.stringify({
      response_block: {
        completeness: 70,
        status: 'FAIL',
        findings: [
          {
            spec_requirement: 'Spec says X',
            gap_description: 'Missing X handling',
            original_code: 'No handler',
            proposed_diff: 'diff --git a/file b/file'
          }
        ],
        recommendations: ['Add handler']
      }
    });
    const parsed = parseValidationOutput(output);
    expect(parsed.completeness).toBe(70);
    expect(parsed.status).toBe('FAIL');
    expect(parsed.gaps[0]).toContain('Spec says X');
    expect(parsed.gaps[0]).toContain('Missing X handling');
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
    const output = JSON.stringify({
      response_block: {
        completeness: 100,
        findings: []
      }
    });
    expect(() => parseValidationOutput(output)).toThrow(/missing "status"/i);
  });

  it('throws when completeness line is missing', () => {
    const output = JSON.stringify({
      response_block: {
        status: 'PASS',
        findings: []
      }
    });
    expect(() => parseValidationOutput(output)).toThrow(/missing "completeness".*available fields/i);
  });

  it('throws when JSON is not provided', () => {
    const output = 'COMPLETENESS: 100%';
    expect(() => parseValidationOutput(output)).toThrow(/json/i);
  });
});
