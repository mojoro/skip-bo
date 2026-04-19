import { describe, it, expect } from 'vitest';
import { createGame } from '@/lib/game/engine';
import { engineStateToView } from './fromEngine';

function makePlayers(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));
}

describe('engineStateToView', () => {
  it('strips seed from the view config', () => {
    const state = createGame({ players: makePlayers(2), ruleset: 'recommended', seed: 12345 });
    const { view } = engineStateToView(state, 0);
    expect(view.config).not.toHaveProperty('seed');
  });

  it('honors youPlayerIndex for view.youSlotIndex', () => {
    const state = createGame({ players: makePlayers(3), ruleset: 'recommended' });
    const { view } = engineStateToView(state, 1);
    expect(view.youSlotIndex).toBe(1);
    expect(view.you.hand).toEqual(state.players[1]!.hand);
    expect(view.you.stockPile).toEqual(state.players[1]!.stockPile);
  });

  it('exposes opponents for every other engine player', () => {
    const state = createGame({ players: makePlayers(3), ruleset: 'recommended' });
    const { view } = engineStateToView(state, 0);
    expect(view.opponents).toHaveLength(2);
    expect(view.opponents.map((o) => o.slotIndex).sort()).toEqual([1, 2]);
    for (const op of view.opponents) {
      const source = state.players[op.slotIndex]!;
      expect(op.handCount).toBe(source.hand.length);
      expect(op.stockCount).toBe(source.stockPile.length);
      if (source.stockPile.length > 0) {
        const top = source.stockPile[source.stockPile.length - 1]!;
        expect(op.stockTop).toEqual({ id: top.id, value: top.value });
      } else {
        expect(op.stockTop).toBeNull();
      }
    }
  });

  it('rewrites partnership team ids to slot indices', () => {
    const state = createGame({
      players: makePlayers(4),
      ruleset: 'recommended',
      partnership: {
        enabled: true,
        teams: [['p1', 'p3'], ['p2', 'p4']],
        allowPlayFromPartnerStock: true,
        allowPlayFromPartnerDiscard: true,
        allowDiscardToPartnerDiscard: true,
      },
    });
    const { view } = engineStateToView(state, 0);
    expect(view.config.partnership).not.toBeNull();
    expect(view.config.partnership!.teams).toEqual([[0, 2], [1, 3]]);
    expect(view.config.partnership!.enabled).toBe(true);
  });

  it('produces synthetic seats: host=youSlot, all human, connected, no grace, no bot', () => {
    const state = createGame({ players: makePlayers(3), ruleset: 'recommended' });
    const { seats } = engineStateToView(state, 2);
    expect(seats).toHaveLength(3);
    for (const s of seats) {
      expect(s.kind).toBe('human');
      expect(s.connected).toBe(true);
      expect(s.graceDeadline).toBeNull();
      expect(s.botControlled).toBe(false);
    }
    expect(seats[0]!.isHost).toBe(false);
    expect(seats[1]!.isHost).toBe(false);
    expect(seats[2]!.isHost).toBe(true);
  });

  it('carries through phase, currentPlayerSlotIndex, stateVersion', () => {
    const state = createGame({ players: makePlayers(2), ruleset: 'recommended' });
    const { view } = engineStateToView(state, 0);
    expect(view.phase).toBe(state.phase);
    expect(view.currentPlayerSlotIndex).toBe(state.currentPlayerIndex);
    expect(view.stateVersion).toBe(state.stateVersion);
  });

  it('carries winningTeamIndex through a finished game', () => {
    const state = createGame({ players: makePlayers(2), ruleset: 'recommended' });
    const finished = { ...state, phase: 'finished' as const, winningTeamIndex: 0 };
    const { view } = engineStateToView(finished, 0);
    expect(view.phase).toBe('finished');
    expect(view.winningTeamIndex).toBe(0);
  });

  it('uses engine player names, not ids, in seat.name', () => {
    const state = createGame({
      players: [
        { id: 'session-abc', name: 'Alice' },
        { id: 'session-xyz', name: 'Bob' },
      ],
      ruleset: 'recommended',
    });
    const { seats } = engineStateToView(state, 0);
    expect(seats[0]!.name).toBe('Alice');
    expect(seats[1]!.name).toBe('Bob');
    // Defensive: assert no sessionId accidentally leaks into any seat field.
    for (const seat of seats) {
      expect(JSON.stringify(seat)).not.toContain('session-abc');
      expect(JSON.stringify(seat)).not.toContain('session-xyz');
    }
  });
});
