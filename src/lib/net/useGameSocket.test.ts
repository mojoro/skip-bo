import { describe, it, expect } from 'vitest';
import { computeReconnectDelay, shouldReconnect } from './useGameSocket';

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
