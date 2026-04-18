import { describe, it, expect } from 'vitest';
import { buildGameView } from '../../src/game/view';
import { makeRoom } from '../fixtures';
import { initializeGameState } from '../../src/room/lifecycle';
import { defaultPartnershipRules } from '@engine/types';

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
    expect(view.view.youSlotIndex).toBe(0);
  });

  it('never leaks shuffle seed or raw sessionIds into the broadcast view', () => {
    // Regression: finding A (seed) and B (opponent ids / partnership teams) in
    // the 2026-04-18 audit. The engine emits these for hot-seat convenience;
    // the wire view must strip them so opponents can't reconstruct hidden
    // state or hijack sessions.
    const room = makeRoom();
    room.slots = [
      { kind: 'human', sessionId: 'alice-session-secret', name: 'Alice', connected: true, joinedAt: 0, graceDeadline: null, graceTimer: null, botControlled: false },
      { kind: 'human', sessionId: 'bob-session-secret',   name: 'Bob',   connected: true, joinedAt: 1, graceDeadline: null, graceTimer: null, botControlled: false },
    ];
    room.config.maxPlayers = 2;
    room.config.partnership = defaultPartnershipRules('recommended', [
      ['alice-session-secret'],
      ['bob-session-secret'],
    ]);
    room.game = initializeGameState(room);

    const view = buildGameView(room, 'alice-session-secret').view;

    expect(view.config).not.toHaveProperty('seed');
    for (const op of view.opponents) {
      expect(typeof op.slotIndex).toBe('number');
      expect(op).not.toHaveProperty('id');
    }
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('alice-session-secret');
    expect(serialized).not.toContain('bob-session-secret');
    // Partnership teams must be rewritten to slot indices.
    expect(view.config.partnership?.teams).toEqual([[0], [1]]);
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
