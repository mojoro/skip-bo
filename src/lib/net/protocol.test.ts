import { describe, it, expect } from 'vitest';
import type { ClientMessage, ServerMessage, GameView, PlayerView } from './protocol';

describe('protocol shapes', () => {
  it('includes requestRematch in ClientMessage', () => {
    const msg: ClientMessage = { type: 'requestRematch' };
    expect(msg.type).toBe('requestRematch');
  });

  it('includes rematchReady in ServerMessage', () => {
    const msg: ServerMessage = { type: 'rematchReady', newRoomId: 'abc' };
    expect(msg.type).toBe('rematchReady');
    expect(msg.newRoomId).toBe('abc');
  });
});

describe('PlayerView null view', () => {
  it('accepts view: null for waiting phase', () => {
    const waiting: PlayerView = {
      config: { ruleset: 'recommended', stockPileSize: 10, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null },
      phase: 'waiting',
      turnPhase: 'play',
      currentPlayerSlotIndex: 0,
      youSlotIndex: 0,
      winningTeamIndex: null,
      stateVersion: 0,
      buildPiles: [],
      drawPileCount: 0,
      you: { name: 'You', hand: [], stockPile: [], discardPiles: [[],[],[],[]] },
      opponents: [],
    };
    expect(waiting.phase).toBe('waiting');
  });

  it('GameView carries hostSlotIndex', () => {
    const view: GameView = {
      view: null,
      seats: [],
      hostSlotIndex: 0,
    };
    expect(view.hostSlotIndex).toBe(0);
    expect(view.view).toBe(null);
  });
});
