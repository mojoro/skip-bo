import { randomInt } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_REGEX = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const CODE_LENGTH = 6;

export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET.charAt(randomInt(0, ALPHABET.length));
  }
  return code;
}

export function isValidRoomCode(input: string): boolean {
  return CODE_REGEX.test(input.toUpperCase());
}

export function normalizeRoomCode(input: string): string {
  return input.toUpperCase();
}
