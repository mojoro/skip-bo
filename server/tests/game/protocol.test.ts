import { describe, it, expect } from 'vitest';
import { ClientMessageSchema, MAX_CHAT_LEN, MAX_MESSAGE_BYTES } from '../../src/game/protocol';

describe('ClientMessageSchema', () => {
  it('accepts a valid action message', () => {
    const parsed = ClientMessageSchema.safeParse({
      type: 'action',
      action: { type: 'DISCARD', handIndex: 0, discardPileIndex: 1, targetPlayerIndex: 0 },
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a valid chat message', () => {
    const parsed = ClientMessageSchema.safeParse({ type: 'chat', text: 'gg' });
    expect(parsed.success).toBe(true);
  });

  it('rejects unknown type', () => {
    const parsed = ClientMessageSchema.safeParse({ type: 'hello' });
    expect(parsed.success).toBe(false);
  });

  it('rejects chat over length cap', () => {
    const parsed = ClientMessageSchema.safeParse({
      type: 'chat', text: 'x'.repeat(MAX_CHAT_LEN + 1),
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects non-object payloads', () => {
    expect(ClientMessageSchema.safeParse(null).success).toBe(false);
    expect(ClientMessageSchema.safeParse(42).success).toBe(false);
    expect(ClientMessageSchema.safeParse('action').success).toBe(false);
  });

  it('exposes a 16 KB max message size', () => {
    expect(MAX_MESSAGE_BYTES).toBe(16 * 1024);
  });

  it('rejects action messages with extra fields', () => {
    const parsed = ClientMessageSchema.safeParse({
      type: 'action',
      action: { type: 'DISCARD', handIndex: 0, discardPileIndex: 0, targetPlayerIndex: 0 },
      extra: 'payload',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects card sources with extra fields', () => {
    const parsed = ClientMessageSchema.safeParse({
      type: 'action',
      action: {
        type: 'PLAY_TO_BUILD',
        source: { from: 'hand', index: 0, extra: 'payload' },
        buildPileIndex: 0,
      },
    });
    expect(parsed.success).toBe(false);
  });
});
