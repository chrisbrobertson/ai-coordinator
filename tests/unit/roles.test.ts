import { describe, it, expect } from 'vitest';
import { assignRoles } from '../../src/tools/roles';


describe('role assignment', () => {
  it('uses default priority when no lead specified', () => {
    const roles = assignRoles(['codex', 'claude']);
    expect(roles.lead).toBe('claude');
    expect(roles.validators).toEqual(['codex']);
  });

  it('rejects when only one tool available', () => {
    expect(() => assignRoles(['claude'])).toThrow('At least 2 AI tools required');
  });

  it('accepts explicit lead and validators', () => {
    const roles = assignRoles(['claude', 'codex', 'gemini'], 'codex', ['claude', 'gemini']);
    expect(roles.lead).toBe('codex');
    expect(roles.validators).toEqual(['claude', 'gemini']);
  });
});
