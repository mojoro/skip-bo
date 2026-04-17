import { describe, expect, it } from 'vitest';
import { applyAction } from './engine';
import { makeTestState } from './testHelpers';

function ok(r: ReturnType<typeof applyAction>) {
  if (!r.ok) throw new Error(`action failed: ${r.error}`);
  return r.state;
}

describe('DISCARD', () => {
  it('moves a hand card to own discard pile', () => {
    const state = makeTestState({
      players: [
        { id: 'p1', hand: [7, 3], stock: [5] },
        { id: 'p2', stock: [5] },
      ],
      drawPile: [1, 1, 1, 1, 1, 1],
    });
    const next = ok(
      applyAction(state, {
        type: 'DISCARD',
        handIndex: 0,
        discardPileIndex: 2,
        targetPlayerIndex: 0,
      }),
    );
    expect(next.players[0].discardPiles[2]).toHaveLength(1);
    expect(next.players[0].discardPiles[2][0].value).toBe(7);
  });

  it('advances currentPlayerIndex after a discard', () => {
    const state = makeTestState({
      players: [
        { id: 'p1', hand: [3], stock: [5] },
        { id: 'p2', stock: [5] },
      ],
      drawPile: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    });
    const next = ok(
      applyAction(state, {
        type: 'DISCARD',
        handIndex: 0,
        discardPileIndex: 0,
        targetPlayerIndex: 0,
      }),
    );
    expect(next.currentPlayerIndex).toBe(1);
  });

  it('refills the new active player hand to handSize on turn start', () => {
    const state = makeTestState({
      handSize: 5,
      players: [
        { id: 'p1', hand: [3], stock: [5] },
        { id: 'p2', hand: [], stock: [5] },
      ],
      drawPile: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    });
    const next = ok(
      applyAction(state, {
        type: 'DISCARD',
        handIndex: 0,
        discardPileIndex: 0,
        targetPlayerIndex: 0,
      }),
    );
    expect(next.players[1].hand).toHaveLength(5);
  });

  it('wraps currentPlayerIndex around the last seat', () => {
    const state = makeTestState({
      players: [
        { id: 'p1', stock: [5] },
        { id: 'p2', stock: [5] },
        { id: 'p3', hand: [3], stock: [5] },
      ],
      currentPlayerIndex: 2,
      drawPile: [1, 1, 1, 1, 1, 1],
    });
    const next = ok(
      applyAction(state, {
        type: 'DISCARD',
        handIndex: 0,
        discardPileIndex: 0,
        targetPlayerIndex: 2,
      }),
    );
    expect(next.currentPlayerIndex).toBe(0);
  });

  describe('partnership discard-to-partner', () => {
    it('rejects discarding to partner when not allowed', () => {
      const state = makeTestState({
        players: [
          { id: 'p1', hand: [3], stock: [5] },
          { id: 'p2', stock: [5] },
        ],
        partnership: {
          enabled: true,
          teams: [['p1', 'p2']],
          allowPlayFromPartnerStock: true,
          allowPlayFromPartnerDiscard: true,
          allowDiscardToPartnerDiscard: false,
        },
      });
      const result = applyAction(state, {
        type: 'DISCARD',
        handIndex: 0,
        discardPileIndex: 0,
        targetPlayerIndex: 1,
      });
      expect(result.ok).toBe(false);
    });

    it('allows discarding to partner when enabled', () => {
      const state = makeTestState({
        players: [
          { id: 'p1', hand: [3], stock: [5] },
          { id: 'p2', stock: [5] },
        ],
        partnership: {
          enabled: true,
          teams: [['p1', 'p2']],
          allowPlayFromPartnerStock: true,
          allowPlayFromPartnerDiscard: true,
          allowDiscardToPartnerDiscard: true,
        },
        drawPile: [1, 1, 1, 1, 1, 1],
      });
      const next = ok(
        applyAction(state, {
          type: 'DISCARD',
          handIndex: 0,
          discardPileIndex: 0,
          targetPlayerIndex: 1,
        }),
      );
      expect(next.players[1].discardPiles[0]).toHaveLength(1);
      expect(next.players[1].discardPiles[0][0].value).toBe(3);
    });

    it('rejects discarding to a non-teammate even with permission', () => {
      const state = makeTestState({
        players: [
          { id: 'p1', hand: [3], stock: [5] },
          { id: 'p2', stock: [5] },
          { id: 'p3', stock: [5] },
          { id: 'p4', stock: [5] },
        ],
        partnership: {
          enabled: true,
          teams: [
            ['p1', 'p3'],
            ['p2', 'p4'],
          ],
          allowPlayFromPartnerStock: true,
          allowPlayFromPartnerDiscard: true,
          allowDiscardToPartnerDiscard: true,
        },
      });
      const result = applyAction(state, {
        type: 'DISCARD',
        handIndex: 0,
        discardPileIndex: 0,
        targetPlayerIndex: 1, // not p1's teammate
      });
      expect(result.ok).toBe(false);
    });
  });

  it('rejects invalid hand index', () => {
    const state = makeTestState({
      players: [
        { id: 'p1', hand: [3], stock: [5] },
        { id: 'p2', stock: [5] },
      ],
    });
    const result = applyAction(state, {
      type: 'DISCARD',
      handIndex: 5,
      discardPileIndex: 0,
      targetPlayerIndex: 0,
    });
    expect(result.ok).toBe(false);
  });
});
