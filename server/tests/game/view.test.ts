import { describe, it, expect } from 'vitest';
import { buildGameView, buildSeats } from '../../src/game/view';
import { makeRoom } from '../fixtures';
import { initializeGameState } from '../../src/room/lifecycle';
import { defaultPartnershipRules } from '@engine/types';
import { RoomManager } from '../../src/room/manager';

describe('buildGameView', () => {
  it('stamps seat presence for every slot', () => {
    const room = makeRoom({ hostSessionId: 'alice' });
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
      isHost: true,
    });
    expect(view.seats[1]).toEqual({
      slotIndex: 1,
      kind: 'human',
      name: 'Bob',
      connected: false,
      graceDeadline: 1700,
      botControlled: false,
      isHost: false,
    });
    expect(view.seats[2]).toEqual({
      slotIndex: 2,
      kind: 'ai',
      name: 'bot-x',
      connected: true,
      graceDeadline: null,
      botControlled: false,
      isHost: false,
    });
    expect(view.seats[3]).toEqual({
      slotIndex: 3,
      kind: 'locked',
      name: null,
      connected: false,
      graceDeadline: null,
      botControlled: false,
      isHost: false,
    });
    expect(view.view!.youSlotIndex).toBe(0);
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

    const view = buildGameView(room, 'alice-session-secret').view!;

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

  it('never leaks secrets across a mixed [human, locked, human, ai] seat layout', () => {
    // Keystone ratchet covered the 2-player partnership layout; this variant
    // locks in the same invariant for a seat arrangement with a non-human
    // slot between humans plus an ai seat, which exercises the mapping layer
    // at non-trivial player indices.
    const room = makeRoom();
    room.slots = [
      { kind: 'human', sessionId: 'alice-secret', name: 'Alice', connected: true,  joinedAt: 0, graceDeadline: null, graceTimer: null, botControlled: false },
      { kind: 'locked' },
      { kind: 'human', sessionId: 'carol-secret', name: 'Carol', connected: false, joinedAt: 2, graceDeadline: null, graceTimer: null, botControlled: false },
      { kind: 'ai', botId: 'bot-zeta', difficulty: 'easy' },
    ];
    room.config.maxPlayers = 4;
    room.config.partnership = null;
    room.game = initializeGameState(room);

    const aliceView = buildGameView(room, 'alice-secret').view!;
    const carolView = buildGameView(room, 'carol-secret').view!;

    for (const view of [aliceView, carolView]) {
      expect(view.config).not.toHaveProperty('seed');
      const serialized = JSON.stringify(view);
      expect(serialized).not.toContain('alice-secret');
      expect(serialized).not.toContain('carol-secret');
      for (const op of view.opponents) {
        expect(typeof op.slotIndex).toBe('number');
        expect(op).not.toHaveProperty('id');
      }
    }
    // Alice sees herself at slot 0; Carol at slot 2. The locked seat has no
    // engine player so it does not appear in opponents for either viewer.
    expect(aliceView.youSlotIndex).toBe(0);
    expect(carolView.youSlotIndex).toBe(2);
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

describe('buildGameView when room.game is null', () => {
  it('returns view: null, populated seats, and hostSlotIndex', () => {
    const mgr = new RoomManager();
    const { room } = mgr.create({
      sessionId: 'host-1',
      playerName: 'Host',
      config: { ruleset: 'recommended', stockPileSize: 10, handSize: 5, bidirectionalBuild: true, maxPlayers: 3, partnership: null },
      allowAiFill: true,
      visibility: 'public',
    });
    // room.phase is 'waiting'; room.game is null here.
    const gv = buildGameView(room, 'host-1');
    expect(gv.view).toBeNull();
    expect(gv.seats).toHaveLength(3);
    expect(gv.seats[0]).toMatchObject({ kind: 'human', name: 'Host', isHost: true });
    expect(gv.hostSlotIndex).toBe(0);
  });
});
