import { describe, it, expect, vi } from 'vitest';
import { startGrace, cancelGrace, GRACE_MS } from '../../src/game/grace';
import { makeRoom } from '../fixtures';

function humanSlot(sessionId: string) {
  return {
    kind: 'human' as const,
    sessionId,
    name: sessionId,
    connected: false,
    joinedAt: 0,
    graceDeadline: null,
    graceTimer: null,
    botControlled: false,
  };
}

describe('grace', () => {
  it('arms a 60 s timer and populates graceDeadline', () => {
    vi.useFakeTimers();
    try {
      const room = makeRoom();
      room.phase = 'playing';
      room.slots = [humanSlot('alice'), humanSlot('bob')];
      const now = Date.now();
      startGrace(room, 0, { onExpire: () => {} });
      const slot = room.slots[0]!;
      expect(slot.kind).toBe('human');
      if (slot.kind !== 'human') throw new Error('unreachable');
      expect(slot.graceDeadline).toBe(now + GRACE_MS);
      expect(slot.graceTimer).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fires onExpire after 60 s and flips botControlled true', () => {
    vi.useFakeTimers();
    try {
      const room = makeRoom();
      room.phase = 'playing';
      room.slots = [humanSlot('alice'), humanSlot('bob')];
      let expired = 0;
      startGrace(room, 0, { onExpire: () => { expired++; } });
      vi.advanceTimersByTime(59_999);
      expect(expired).toBe(0);
      vi.advanceTimersByTime(2);
      expect(expired).toBe(1);
      const slot = room.slots[0]!;
      if (slot.kind !== 'human') throw new Error('unreachable');
      expect(slot.botControlled).toBe(true);
      expect(slot.graceDeadline).toBeNull();
      expect(slot.graceTimer).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancelGrace clears the timer and never fires onExpire', () => {
    vi.useFakeTimers();
    try {
      const room = makeRoom();
      room.phase = 'playing';
      room.slots = [humanSlot('alice')];
      let expired = 0;
      startGrace(room, 0, { onExpire: () => { expired++; } });
      vi.advanceTimersByTime(30_000);
      cancelGrace(room, 0);
      vi.advanceTimersByTime(60_000);
      expect(expired).toBe(0);
      const slot = room.slots[0]!;
      if (slot.kind !== 'human') throw new Error('unreachable');
      expect(slot.graceDeadline).toBeNull();
      expect(slot.graceTimer).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('two concurrent timers do not interfere', () => {
    vi.useFakeTimers();
    try {
      const room = makeRoom();
      room.phase = 'playing';
      room.slots = [humanSlot('alice'), humanSlot('bob')];
      const fired: number[] = [];
      startGrace(room, 0, { onExpire: () => fired.push(0) });
      vi.advanceTimersByTime(30_000);
      startGrace(room, 1, { onExpire: () => fired.push(1) });
      vi.advanceTimersByTime(30_000);
      expect(fired).toEqual([0]);
      vi.advanceTimersByTime(30_000);
      expect(fired).toEqual([0, 1]);
    } finally {
      vi.useRealTimers();
    }
  });
});
