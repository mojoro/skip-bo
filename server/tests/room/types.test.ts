import { describe, it, expect } from 'vitest';
import type { Room, Slot, RoomInfo, LobbyStats, RoomPhase } from '../../src/types';
import { makeRoom } from '../fixtures';

describe('types', () => {
  it('Room carries all required fields', () => {
    const room = makeRoom();
    expect(room.id).toBeDefined();
    expect(room.code).toHaveLength(6);
    expect(room.slots).toHaveLength(room.config.maxPlayers);
    expect(room.phase).toBe<RoomPhase>('waiting');
    expect(room.game).toBeNull();
  });

  it('an open slot is a discriminated union', () => {
    const room = makeRoom();
    const openSlot: Slot = { kind: 'open' };
    expect(openSlot.kind).toBe('open');
    expect(room.slots.some((s) => s.kind === 'open')).toBe(true);
  });
});
