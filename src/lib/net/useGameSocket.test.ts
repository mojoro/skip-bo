import { describe, it, expect } from 'vitest';
import { computeReconnectDelay, shouldReconnect, applyServerMessageToRematch, clearRematchOnIdentityChange } from './useGameSocket';
import type { ServerMessage } from './protocol';

describe('useGameSocket helpers', () => {
  it('caps backoff at 10 s', () => {
    expect(computeReconnectDelay(0, () => 1)).toBeLessThanOrEqual(10_000);
    expect(computeReconnectDelay(1, () => 1)).toBeLessThanOrEqual(10_000);
    expect(computeReconnectDelay(6, () => 1)).toBe(10_000);
  });

  it('applies [0.5, 1.0] jitter', () => {
    const mid = computeReconnectDelay(1, () => 0.5);
    expect(mid).toBe(Math.round(1000 * 0.75)); // 500 * 2^1 * (0.5 + 0.5/2)
  });

  it('does not reconnect on terminal codes', () => {
    for (const code of [1008, 4002, 4003, 4004, 4005]) expect(shouldReconnect(code)).toBe(false);
    // 1001 (going away), 1006 (abnormal close), 1011 (server error), and
    // 4006 (room not playing yet — pre-start race) must keep reconnecting.
    for (const code of [1001, 1006, 1011, 4006]) expect(shouldReconnect(code)).toBe(true);
  });

  it('saturates the backoff at the attempt ceiling', () => {
    expect(computeReconnectDelay(1_000_000, () => 1)).toBe(10_000);
    expect(computeReconnectDelay(1_000_000, () => 0.5)).toBe(Math.round(10_000 * 0.75));
  });
});

describe('applyServerMessageToRematch', () => {
  it('sets rematchRoomId on rematchReady', () => {
    const msg: ServerMessage = { type: 'rematchReady', newRoomId: 'room-42' };
    expect(applyServerMessageToRematch(null, msg)).toBe('room-42');
  });

  it('is idempotent when applied twice with the same id', () => {
    const msg: ServerMessage = { type: 'rematchReady', newRoomId: 'room-42' };
    const first = applyServerMessageToRematch(null, msg);
    const second = applyServerMessageToRematch(first, msg);
    expect(second).toBe('room-42');
  });

  it("last-write-wins if a different id arrives (shouldn't happen, but defensive)", () => {
    const first = applyServerMessageToRematch(null, { type: 'rematchReady', newRoomId: 'a' });
    const second = applyServerMessageToRematch(first, { type: 'rematchReady', newRoomId: 'b' });
    expect(second).toBe('b');
  });

  it('leaves existing rematchRoomId untouched on other message types', () => {
    const msg: ServerMessage = { type: 'chat', fromSlotIndex: 0, fromName: 'x', text: 'y', sentAt: 0 };
    expect(applyServerMessageToRematch('room-42', msg)).toBe('room-42');
  });
});

describe('clearRematchOnIdentityChange', () => {
  it('clears rematchRoomId when roomId changes', () => {
    expect(
      clearRematchOnIdentityChange({ prevRoomId: 'a', prevSessionId: 's', nextRoomId: 'b', nextSessionId: 's', rematch: 'r' }),
    ).toBeNull();
  });

  it('clears rematchRoomId when sessionId changes', () => {
    expect(
      clearRematchOnIdentityChange({ prevRoomId: 'a', prevSessionId: 's1', nextRoomId: 'a', nextSessionId: 's2', rematch: 'r' }),
    ).toBeNull();
  });

  it('keeps rematchRoomId when neither roomId nor sessionId changed', () => {
    expect(
      clearRematchOnIdentityChange({ prevRoomId: 'a', prevSessionId: 's', nextRoomId: 'a', nextSessionId: 's', rematch: 'r' }),
    ).toBe('r');
  });
});
