import { describe, it, expect, vi } from 'vitest';
import { maybeRunBotTurn, BOT_MOVE_DELAY_MS } from '../../src/game/bot';
import { makeRoom } from '../fixtures';
import { initializeGameState } from '../../src/room/lifecycle';

function playingRoomAllAi() {
  const room = makeRoom();
  room.slots = [
    { kind: 'ai', botId: 'bot-a', difficulty: 'easy' },
    { kind: 'ai', botId: 'bot-b', difficulty: 'easy' },
  ];
  room.config.maxPlayers = 2;
  room.phase = 'playing';
  room.game = initializeGameState(room);
  return room;
}

describe('maybeRunBotTurn', () => {
  it('no-ops when room.phase is not playing', () => {
    vi.useFakeTimers();
    try {
      const room = playingRoomAllAi();
      room.phase = 'finished';
      let fired = 0;
      maybeRunBotTurn(room, { onAfterMove: () => fired++ });
      vi.advanceTimersByTime(BOT_MOVE_DELAY_MS + 100);
      expect(fired).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('no-ops when current seat is a connected human', () => {
    vi.useFakeTimers();
    try {
      const room = makeRoom();
      room.slots = [
        { kind: 'human', sessionId: 'a', name: 'A', connected: true, joinedAt: 0, graceDeadline: null, graceTimer: null, botControlled: false },
        { kind: 'human', sessionId: 'b', name: 'B', connected: true, joinedAt: 1, graceDeadline: null, graceTimer: null, botControlled: false },
      ];
      room.config.maxPlayers = 2;
      room.phase = 'playing';
      room.game = initializeGameState(room);
      let fired = 0;
      maybeRunBotTurn(room, { onAfterMove: () => fired++ });
      vi.advanceTimersByTime(BOT_MOVE_DELAY_MS + 100);
      expect(fired).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('schedules a bot move for an ai seat and bumps stateVersion', () => {
    vi.useFakeTimers();
    try {
      const room = playingRoomAllAi();
      const prev = room.game!.stateVersion;
      let fired = 0;
      maybeRunBotTurn(room, { onAfterMove: () => fired++ });
      vi.advanceTimersByTime(BOT_MOVE_DELAY_MS + 1);
      expect(fired).toBe(1);
      expect(room.game!.stateVersion).toBeGreaterThan(prev);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is idempotent: second call while pending is a no-op', () => {
    vi.useFakeTimers();
    try {
      const room = playingRoomAllAi();
      let fired = 0;
      maybeRunBotTurn(room, { onAfterMove: () => fired++ });
      maybeRunBotTurn(room, { onAfterMove: () => fired++ });
      vi.advanceTimersByTime(BOT_MOVE_DELAY_MS + 1);
      expect(fired).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('schedules a bot move for a botControlled human seat', () => {
    vi.useFakeTimers();
    try {
      const room = makeRoom();
      room.slots = [
        { kind: 'human', sessionId: 'a', name: 'A', connected: false, joinedAt: 0, graceDeadline: null, graceTimer: null, botControlled: true },
        { kind: 'ai', botId: 'bot-b', difficulty: 'easy' },
      ];
      room.config.maxPlayers = 2;
      room.phase = 'playing';
      room.game = initializeGameState(room);
      room.game!.currentPlayerIndex = 0; // force bot-controlled human to be current
      let fired = 0;
      maybeRunBotTurn(room, { onAfterMove: () => fired++ });
      vi.advanceTimersByTime(BOT_MOVE_DELAY_MS + 1);
      expect(fired).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
