import { describe, it, expect } from 'vitest';
import { dispatchMessage } from '../../src/game/dispatch';
import { makeRoom } from '../fixtures';
import { initializeGameState } from '../../src/room/lifecycle';
import type { ClientMessage } from '../../src/game/protocol';

function readyPlayingRoom(sessionIds: string[]) {
  const room = makeRoom();
  room.slots = sessionIds.map((sid, i) => ({
    kind: 'human' as const,
    sessionId: sid,
    name: sid,
    connected: true,
    joinedAt: i,
    graceDeadline: null,
    graceTimer: null,
    botControlled: false,
  }));
  room.config.maxPlayers = sessionIds.length;
  room.phase = 'playing';
  room.game = initializeGameState(room);
  return room;
}

describe('dispatchMessage', () => {
  it('rejects an action from a non-current player with actionError', () => {
    const room = readyPlayingRoom(['alice', 'bob']);
    const current = room.game!.players[room.game!.currentPlayerIndex]!.id;
    const other = current === 'alice' ? 'bob' : 'alice';
    const msg: ClientMessage = {
      type: 'action',
      action: {
        type: 'DISCARD',
        handIndex: 0,
        discardPileIndex: 0,
        targetPlayerIndex: 0,
      },
    };
    const effects = dispatchMessage(room, other, msg, { now: () => 0 });
    expect(effects).toEqual([
      {
        kind: 'sendTo',
        sessionId: other,
        message: {
          type: 'actionError',
          reason: 'notYourTurn',
          stateVersion: room.game!.stateVersion,
        },
      },
    ]);
  });

  it('commits a legal action, bumps stateVersion, and emits broadcast', () => {
    const room = readyPlayingRoom(['alice', 'bob']);
    const current = room.game!.players[room.game!.currentPlayerIndex]!.id;
    const prevVersion = room.game!.stateVersion;
    const msg: ClientMessage = {
      type: 'action',
      action: {
        type: 'DISCARD',
        handIndex: 0,
        discardPileIndex: 0,
        targetPlayerIndex: room.game!.currentPlayerIndex,
      },
    };
    const effects = dispatchMessage(room, current, msg, { now: () => 0 });
    const broadcast = effects.find((e) => e.kind === 'broadcastState');
    expect(broadcast).toBeDefined();
    expect(room.game!.stateVersion).toBe(prevVersion + 1);
  });

  it('broadcasts a chat after truncating and stripping control chars', () => {
    const room = readyPlayingRoom(['alice', 'bob']);
    const msg: ClientMessage = { type: 'chat', text: 'hi\x00 there' };
    const effects = dispatchMessage(room, 'alice', msg, { now: () => 42 });
    expect(effects).toEqual([
      {
        kind: 'broadcastChat',
        chat: {
          type: 'chat',
          fromSlotIndex: 0,
          fromName: 'alice',
          text: 'hi there',
          sentAt: 42,
        },
      },
    ]);
  });

  it('rejects an action when room.phase is not playing', () => {
    const room = readyPlayingRoom(['alice', 'bob']);
    room.phase = 'finished';
    const current = room.game!.players[room.game!.currentPlayerIndex]!.id;
    const msg: ClientMessage = {
      type: 'action',
      action: {
        type: 'DISCARD',
        handIndex: 0,
        discardPileIndex: 0,
        targetPlayerIndex: room.game!.currentPlayerIndex,
      },
    };
    const effects = dispatchMessage(room, current, msg, { now: () => 0 });
    expect(effects[0]).toMatchObject({
      kind: 'sendTo',
      message: { type: 'actionError', reason: 'notPlaying' },
    });
  });

  it('rejects an action from a disconnected human', () => {
    const room = readyPlayingRoom(['alice', 'bob']);
    const current = room.game!.players[room.game!.currentPlayerIndex]!.id;
    const slotIndex = room.slots.findIndex(
      (s) => s.kind === 'human' && s.sessionId === current,
    );
    const slot = room.slots[slotIndex] as Extract<
      (typeof room.slots)[number],
      { kind: 'human' }
    >;
    slot.connected = false;
    const msg: ClientMessage = {
      type: 'action',
      action: {
        type: 'DISCARD',
        handIndex: 0,
        discardPileIndex: 0,
        targetPlayerIndex: room.game!.currentPlayerIndex,
      },
    };
    const effects = dispatchMessage(room, current, msg, { now: () => 0 });
    expect(effects[0]).toMatchObject({
      kind: 'sendTo',
      message: { type: 'actionError', reason: 'notConnected' },
    });
  });
});
