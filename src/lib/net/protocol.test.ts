import { describe, it, expect } from 'vitest';
import type { ClientMessage, ServerMessage, GameView } from './protocol';

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

const minimalConfig = {
  ruleset: 'recommended' as const,
  stockPileSize: 10,
  handSize: 5,
  bidirectionalBuild: false,
  maxPlayers: 2,
  partnership: null,
};

describe('PlayerView null view', () => {
  it('accepts view: null for waiting phase', () => {
    const view: GameView = {
      view: null,
      seats: [],
      hostSlotIndex: null,
      config: minimalConfig,
      allowAiFill: false,
      youSlotIndex: 0,
    };
    expect(view.view).toBeNull();
  });

  it('GameView carries hostSlotIndex', () => {
    const view: GameView = {
      view: null,
      seats: [],
      hostSlotIndex: 0,
      config: minimalConfig,
      allowAiFill: false,
      youSlotIndex: 0,
    };
    expect(view.hostSlotIndex).toBe(0);
    expect(view.view).toBe(null);
  });
});
