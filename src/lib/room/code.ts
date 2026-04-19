export function normalizeRoomCode(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.toUpperCase();
}
