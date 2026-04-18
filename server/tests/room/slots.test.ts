import { describe, it, expect } from 'vitest';
import {
  summarizeSlots,
  countHumans,
  findOpenSlot,
  projectRoomInfo,
  hostDisplayName,
} from '../../src/room/slots';
import { makeRoom } from '../fixtures';

describe('slot helpers', () => {
  it('summarizes a mix of slot kinds', () => {
    const room = makeRoom();
    room.slots = [
      { kind: 'human', sessionId: 'a', name: 'A', connected: true, joinedAt: 0, graceDeadline: null, graceTimer: null, botControlled: false },
      { kind: 'ai', botId: 'b1', difficulty: 'easy' },
      { kind: 'open' },
      { kind: 'locked' },
    ];
    expect(summarizeSlots(room.slots)).toEqual({
      humans: 1, ai: 1, open: 1, locked: 1, capacity: 4,
    });
  });

  it('counts connected and disconnected humans together', () => {
    const room = makeRoom();
    room.slots = [
      { kind: 'human', sessionId: 'a', name: 'A', connected: true, joinedAt: 0, graceDeadline: null, graceTimer: null, botControlled: false },
      { kind: 'human', sessionId: 'b', name: 'B', connected: false, joinedAt: 1, graceDeadline: null, graceTimer: null, botControlled: false },
      { kind: 'open' }, { kind: 'open' },
    ];
    expect(countHumans(room.slots)).toBe(2);
  });

  it('findOpenSlot returns the first open index or -1', () => {
    const room = makeRoom();
    expect(findOpenSlot(room.slots)).toBe(1);
    room.slots[1] = { kind: 'locked' };
    expect(findOpenSlot(room.slots)).toBe(2);
    room.slots = room.slots.map(() => ({ kind: 'locked' as const }));
    expect(findOpenSlot(room.slots)).toBe(-1);
  });

  it('hostDisplayName returns host slot name or Host', () => {
    const room = makeRoom();
    expect(hostDisplayName(room)).toBe('John');
    room.slots[0] = { kind: 'open' };
    expect(hostDisplayName(room)).toBe('Host');
  });

  describe('projectRoomInfo', () => {
    it('exposes code for public rooms', () => {
      const room = makeRoom();
      const info = projectRoomInfo(room, { context: 'list' });
      expect(info.code).toBe(room.code);
      expect(info.hostName).toBe('John');
      expect(info.slotSummary.capacity).toBe(4);
    });

    it('nulls code in list view when private', () => {
      const room = makeRoom({ visibility: 'private' });
      expect(projectRoomInfo(room, { context: 'list' }).code).toBeNull();
    });

    it('keeps code on direct lookups even for private rooms', () => {
      const room = makeRoom({ visibility: 'private' });
      expect(projectRoomInfo(room, { context: 'direct' }).code).toBe(room.code);
    });
  });
});
