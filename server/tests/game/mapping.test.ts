import { describe, it, expect } from 'vitest';
import { slotIndexForPlayerId, playerIndexForSlotIndex, currentPlayerSlotIndex } from '../../src/game/mapping';
import { makeRoom } from '../fixtures';
import { initializeGameState } from '../../src/room/lifecycle';

describe('slot/player mapping', () => {
  it('maps human sessionId and ai botId to their slot indices', () => {
    const room = makeRoom();
    room.slots = [
      { kind: 'human', sessionId: 'alice', name: 'A', connected: true, joinedAt: 0, graceDeadline: null, graceTimer: null, botControlled: false },
      { kind: 'locked' },
      { kind: 'ai', botId: 'bot-x', difficulty: 'easy' },
      { kind: 'human', sessionId: 'bob', name: 'B', connected: true, joinedAt: 1, graceDeadline: null, graceTimer: null, botControlled: false },
    ];
    room.game = initializeGameState(room);
    expect(slotIndexForPlayerId(room, 'alice')).toBe(0);
    expect(slotIndexForPlayerId(room, 'bot-x')).toBe(2);
    expect(slotIndexForPlayerId(room, 'bob')).toBe(3);
    expect(slotIndexForPlayerId(room, 'ghost')).toBe(-1);
  });

  it('maps engine player index back to slot index skipping locked', () => {
    const room = makeRoom();
    room.slots = [
      { kind: 'human', sessionId: 'alice', name: 'A', connected: true, joinedAt: 0, graceDeadline: null, graceTimer: null, botControlled: false },
      { kind: 'locked' },
      { kind: 'ai', botId: 'bot-x', difficulty: 'easy' },
    ];
    room.game = initializeGameState(room);
    expect(playerIndexForSlotIndex(room, 0)).toBe(0); // alice = engine player 0
    expect(playerIndexForSlotIndex(room, 1)).toBe(-1); // locked has no player
    expect(playerIndexForSlotIndex(room, 2)).toBe(1); // bot-x = engine player 1
  });

  it('maps current player to their slot index', () => {
    const room = makeRoom();
    room.slots = [
      { kind: 'human', sessionId: 'alice', name: 'A', connected: true, joinedAt: 0, graceDeadline: null, graceTimer: null, botControlled: false },
      { kind: 'locked' },
      { kind: 'ai', botId: 'bot-x', difficulty: 'easy' },
    ];
    room.game = initializeGameState(room);
    const currentPlayerId = room.game.players[room.game.currentPlayerIndex]!.id;
    expect(currentPlayerSlotIndex(room)).toBe(slotIndexForPlayerId(room, currentPlayerId));
  });
});
