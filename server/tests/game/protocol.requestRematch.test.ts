import { describe, it, expect } from 'vitest';
import { ClientMessageSchema } from '../../src/game/protocol';

describe('ClientMessageSchema requestRematch', () => {
  it('accepts { type: "requestRematch" }', () => {
    const parsed = ClientMessageSchema.safeParse({ type: 'requestRematch' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.type).toBe('requestRematch');
  });

  it('rejects requestRematch with extra fields (strict)', () => {
    const parsed = ClientMessageSchema.safeParse({ type: 'requestRematch', extra: 1 });
    expect(parsed.success).toBe(false);
  });
});
