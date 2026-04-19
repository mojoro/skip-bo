import { describe, it, expect } from 'vitest';
import { normalizeRoomCode } from './code';

describe('normalizeRoomCode', () => {
  it('uppercases lowercase input', () => {
    expect(normalizeRoomCode('abcd12')).toBe('ABCD12');
  });

  it('leaves already-uppercase input unchanged', () => {
    expect(normalizeRoomCode('ABCD12')).toBe('ABCD12');
  });

  it('uppercases mixed-case input', () => {
    expect(normalizeRoomCode('aBcD12')).toBe('ABCD12');
  });

  it('returns empty string for non-string input', () => {
    expect(normalizeRoomCode(null)).toBe('');
  });
});
