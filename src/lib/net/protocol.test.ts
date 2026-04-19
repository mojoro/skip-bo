import { describe, it, expect } from 'vitest';
import type { ClientMessage, ServerMessage } from './protocol';

describe('protocol shapes', () => {
  it('includes requestRematch in ClientMessage', () => {
    const msg: ClientMessage = { type: 'requestRematch' };
    expect(msg.type).toBe('requestRematch');
  });

  it('includes rematchReady in ServerMessage', () => {
    const msg: ServerMessage = { type: 'rematchReady', newRoomId: 'abc' };
    expect(msg.type).toBe('rematchReady');
    expect(msg.newRoomId).toBe('abc');
  });
});
