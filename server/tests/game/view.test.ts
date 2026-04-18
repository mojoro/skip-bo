import { describe, it, expect } from 'vitest';
import { buildGameView } from '../../src/game/view';
import { makeRoom } from '../fixtures';
import { initializeGameState } from '../../src/room/lifecycle';

describe('buildGameView', () => {
  it('stamps seat presence for every slot', () => {
    const room = makeRoom();
    room.slots = [
      {
        kind: 'human',
        sessionId: 'alice',
        name: 'Alice',
        connected: true,
        joinedAt: 0,
        graceDeadline: null,
        graceTimer: null,
        botControlled: false,
      },
      {
        kind: 'human',
        sessionId: 'bob',
        name: 'Bob',
        connected: false,
        joinedAt: 1,
        graceDeadline: 1700,
        graceTimer: null,
        botControlled: false,
      },
      { kind: 'ai', botId: 'bot-x', difficulty: 'easy' },
      { kind: 'locked' },
    ];
    room.config.maxPlayers = 4;
    room.game = initializeGameState(room);

    const view = buildGameView(room, 'alice');

    expect(view.seats).toHaveLength(4);
    expect(view.seats[0]).toEqual({
      slotIndex: 0,
      kind: 'human',
      name: 'Alice',
      connected: true,
      graceDeadline: null,
      botControlled: false,
    });
    expect(view.seats[1]).toEqual({
      slotIndex: 1,
      kind: 'human',
      name: 'Bob',
      connected: false,
      graceDeadline: 1700,
      botControlled: false,
    });
    expect(view.seats[2]).toEqual({
      slotIndex: 2,
      kind: 'ai',
      name: 'bot-x',
      connected: true,
      graceDeadline: null,
      botControlled: false,
    });
    expect(view.seats[3]).toEqual({
      slotIndex: 3,
      kind: 'locked',
      name: null,
      connected: false,
      graceDeadline: null,
      botControlled: false,
    });
    expect(view.view.youIndex).toBe(0);
  });

  it('throws if sessionId has no matching engine player', () => {
    const room = makeRoom();
    room.slots = [
      {
        kind: 'human',
        sessionId: 'alice',
        name: 'Alice',
        connected: true,
        joinedAt: 0,
        graceDeadline: null,
        graceTimer: null,
        botControlled: false,
      },
      {
        kind: 'human',
        sessionId: 'bob',
        name: 'Bob',
        connected: true,
        joinedAt: 1,
        graceDeadline: null,
        graceTimer: null,
        botControlled: false,
      },
    ];
    room.game = initializeGameState(room);
    expect(() => buildGameView(room, 'ghost')).toThrow();
  });
});
