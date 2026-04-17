import { describe, it, expect } from 'vitest';
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from '../../src/room/code';

describe('room code', () => {
  it('generates a 6-char code from the safe alphabet', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateRoomCode();
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });

  it('validates codes ignoring case', () => {
    expect(isValidRoomCode('ABCD23')).toBe(true);
    expect(isValidRoomCode('abcd23')).toBe(true);
    expect(isValidRoomCode('ABCD2')).toBe(false);
    expect(isValidRoomCode('ABCD0O')).toBe(false);
    expect(isValidRoomCode('ABC12D')).toBe(false);
  });

  it('normalizes to uppercase', () => {
    expect(normalizeRoomCode('abcd23')).toBe('ABCD23');
  });
});
