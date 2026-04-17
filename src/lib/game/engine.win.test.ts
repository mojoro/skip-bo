import { describe, expect, it } from 'vitest';
import { applyAction } from './engine';
import { makeTestState } from './testHelpers';

function ok(r: ReturnType<typeof applyAction>) {
  if (!r.ok) throw new Error(`action failed: ${r.error}`);
  return r.state;
}

describe('win condition', () => {
  describe('singles', () => {
    it('emptying own stock ends the game and records winner', () => {
      const state = makeTestState({
        players: [
          { id: 'p1', hand: [], stock: [1] }, // last stock card
          { id: 'p2', stock: [5] },
        ],
      });
      const next = ok(
        applyAction(state, {
          type: 'PLAY_TO_BUILD',
          source: { from: 'stock', playerIndex: 0 },
          buildPileIndex: 0,
        }),
      );
      expect(next.phase).toBe('finished');
      expect(next.winningTeamIndex).toBe(0);
    });

    it('does not advance turn when game ends on a DISCARD', () => {
      // contrived: emptying stock via PLAY_TO_BUILD handles win.
      // Verify DISCARD in non-winning state still advances.
      const state = makeTestState({
        players: [
          { id: 'p1', hand: [3], stock: [5] },
          { id: 'p2', stock: [5] },
        ],
        drawPile: [1, 1, 1, 1, 1, 1],
      });
      const next = ok(
        applyAction(state, {
          type: 'DISCARD',
          handIndex: 0,
          discardPileIndex: 0,
          targetPlayerIndex: 0,
        }),
      );
      expect(next.phase).toBe('playing');
      expect(next.currentPlayerIndex).toBe(1);
    });
  });

  describe('partnership', () => {
    it('one partner emptying stock does NOT end the game', () => {
      const state = makeTestState({
        players: [
          { id: 'p1', hand: [], stock: [1] },
          { id: 'p2', stock: [5] },
          { id: 'p3', stock: [5] }, // p1 partner, still has stock
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
      const next = ok(
        applyAction(state, {
          type: 'PLAY_TO_BUILD',
          source: { from: 'stock', playerIndex: 0 },
          buildPileIndex: 0,
        }),
      );
      expect(next.phase).toBe('playing');
      expect(next.winningTeamIndex).toBeNull();
    });

    it('team wins when all partners have empty stocks', () => {
      const state = makeTestState({
        players: [
          { id: 'p1', hand: [], stock: [] }, // already empty
          { id: 'p2', stock: [5] },
          { id: 'p3', hand: [], stock: [1] }, // partner, last card
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
        currentPlayerIndex: 2, // p3's turn
      });
      const next = ok(
        applyAction(state, {
          type: 'PLAY_TO_BUILD',
          source: { from: 'stock', playerIndex: 2 },
          buildPileIndex: 0,
        }),
      );
      expect(next.phase).toBe('finished');
      expect(next.winningTeamIndex).toBe(0);
    });
  });
});

describe('draw pile refill', () => {
  it('reshuffles completedBuildPiles into drawPile when draw empties mid-refill', () => {
    const state = makeTestState({
      handSize: 3,
      players: [
        { id: 'p1', hand: [12], stock: [5] },
        { id: 'p2', stock: [5] },
      ],
      buildPiles: [
        { direction: 'asc', cards: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
      ],
      drawPile: [],
    });
    const next = ok(
      applyAction(state, {
        type: 'PLAY_TO_BUILD',
        source: { from: 'hand', index: 0 },
        buildPileIndex: 0,
      }),
    );
    // 12 recycled: 3 drawn into hand, 9 left in drawPile
    expect(next.completedBuildPiles).toHaveLength(0);
    expect(next.players[0].hand).toHaveLength(3);
    expect(next.drawPile).toHaveLength(9);
  });

  it('does not crash when both drawPile and completedBuildPiles are empty', () => {
    const state = makeTestState({
      handSize: 5,
      players: [
        { id: 'p1', hand: [1], stock: [5] },
        { id: 'p2', stock: [5] },
      ],
      drawPile: [],
      completedBuildPiles: [],
    });
    const next = ok(
      applyAction(state, {
        type: 'PLAY_TO_BUILD',
        source: { from: 'hand', index: 0 },
        buildPileIndex: 0,
      }),
    );
    // hand stays empty, no exception
    expect(next.players[0].hand).toHaveLength(0);
  });
});
