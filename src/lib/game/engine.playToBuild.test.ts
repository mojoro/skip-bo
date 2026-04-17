import { describe, expect, it } from 'vitest';
import { applyAction } from './engine';
import { makeTestState, WILD } from './testHelpers';

function ok(r: ReturnType<typeof applyAction>) {
  if (!r.ok) throw new Error(`action failed: ${r.error}`);
  return r.state;
}

describe('PLAY_TO_BUILD', () => {
  describe('empty pile validation', () => {
    it('asc-only: accepts 1 on empty pile', () => {
      const state = makeTestState({
        ruleset: 'official',
        bidirectional: false,
        players: [
          { id: 'p1', hand: [1], stock: [5] },
          { id: 'p2', stock: [5] },
        ],
      });
      const result = applyAction(state, {
        type: 'PLAY_TO_BUILD',
        source: { from: 'hand', index: 0 },
        buildPileIndex: 0,
      });
      expect(result.ok).toBe(true);
    });

    it('asc-only: rejects 12 on empty pile', () => {
      const state = makeTestState({
        ruleset: 'official',
        bidirectional: false,
        players: [
          { id: 'p1', hand: [12], stock: [5] },
          { id: 'p2', stock: [5] },
        ],
      });
      const result = applyAction(state, {
        type: 'PLAY_TO_BUILD',
        source: { from: 'hand', index: 0 },
        buildPileIndex: 0,
      });
      expect(result.ok).toBe(false);
    });

    it('bidirectional: 1 starts asc direction', () => {
      const state = makeTestState({
        bidirectional: true,
        players: [
          { id: 'p1', hand: [1], stock: [5] },
          { id: 'p2', stock: [5] },
        ],
      });
      const next = ok(
        applyAction(state, {
          type: 'PLAY_TO_BUILD',
          source: { from: 'hand', index: 0 },
          buildPileIndex: 0,
        }),
      );
      expect(next.buildPiles[0].direction).toBe('asc');
    });

    it('bidirectional: 12 starts desc direction', () => {
      const state = makeTestState({
        bidirectional: true,
        players: [
          { id: 'p1', hand: [12], stock: [5] },
          { id: 'p2', stock: [5] },
        ],
      });
      const next = ok(
        applyAction(state, {
          type: 'PLAY_TO_BUILD',
          source: { from: 'hand', index: 0 },
          buildPileIndex: 0,
        }),
      );
      expect(next.buildPiles[0].direction).toBe('desc');
    });

    it('bidirectional: wild on empty requires declaredDirection', () => {
      const state = makeTestState({
        bidirectional: true,
        players: [
          { id: 'p1', hand: [WILD], stock: [5] },
          { id: 'p2', stock: [5] },
        ],
      });
      const missing = applyAction(state, {
        type: 'PLAY_TO_BUILD',
        source: { from: 'hand', index: 0 },
        buildPileIndex: 0,
      });
      expect(missing.ok).toBe(false);

      const withDecl = ok(
        applyAction(state, {
          type: 'PLAY_TO_BUILD',
          source: { from: 'hand', index: 0 },
          buildPileIndex: 0,
          declaredDirection: 'desc',
        }),
      );
      expect(withDecl.buildPiles[0].direction).toBe('desc');
    });

    it('asc-only: wild on empty auto-locks asc, no declaration needed', () => {
      const state = makeTestState({
        ruleset: 'official',
        bidirectional: false,
        players: [
          { id: 'p1', hand: [WILD], stock: [5] },
          { id: 'p2', stock: [5] },
        ],
      });
      const next = ok(
        applyAction(state, {
          type: 'PLAY_TO_BUILD',
          source: { from: 'hand', index: 0 },
          buildPileIndex: 0,
        }),
      );
      expect(next.buildPiles[0].direction).toBe('asc');
    });
  });

  describe('sequence validation', () => {
    it('asc: requires pile.length + 1', () => {
      const state = makeTestState({
        players: [
          { id: 'p1', hand: [3, 5], stock: [5] },
          { id: 'p2', stock: [5] },
        ],
        buildPiles: [{ direction: 'asc', cards: [1, 2] }],
      });
      // hand index 1 is value 5, cannot play (pile needs 3)
      const bad = applyAction(state, {
        type: 'PLAY_TO_BUILD',
        source: { from: 'hand', index: 1 },
        buildPileIndex: 0,
      });
      expect(bad.ok).toBe(false);
      // hand index 0 is value 3, valid
      const good = applyAction(state, {
        type: 'PLAY_TO_BUILD',
        source: { from: 'hand', index: 0 },
        buildPileIndex: 0,
      });
      expect(good.ok).toBe(true);
    });

    it('desc: requires 12 - pile.length', () => {
      const state = makeTestState({
        bidirectional: true,
        players: [
          { id: 'p1', hand: [10, 7], stock: [5] },
          { id: 'p2', stock: [5] },
        ],
        buildPiles: [{ direction: 'desc', cards: [12, 11] }],
      });
      // pile has 2 cards, needs 12-2 = 10
      const good = applyAction(state, {
        type: 'PLAY_TO_BUILD',
        source: { from: 'hand', index: 0 },
        buildPileIndex: 0,
      });
      expect(good.ok).toBe(true);
    });

    it('wild plays as any required value mid-pile', () => {
      const state = makeTestState({
        players: [
          { id: 'p1', hand: [WILD], stock: [5] },
          { id: 'p2', stock: [5] },
        ],
        buildPiles: [{ direction: 'asc', cards: [1, 2, 3, 4, 5] }],
      });
      const next = ok(
        applyAction(state, {
          type: 'PLAY_TO_BUILD',
          source: { from: 'hand', index: 0 },
          buildPileIndex: 0,
        }),
      );
      expect(next.buildPiles[0].cards).toHaveLength(6);
    });
  });

  describe('pile completion', () => {
    it('completing 12 cards moves pile to completedBuildPiles and resets slot', () => {
      const state = makeTestState({
        players: [
          { id: 'p1', hand: [12, 1, 1, 1, 1], stock: [5] }, // hand stays nonempty after play
          { id: 'p2', stock: [5] },
        ],
        buildPiles: [
          { direction: 'asc', cards: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
        ],
      });
      const next = ok(
        applyAction(state, {
          type: 'PLAY_TO_BUILD',
          source: { from: 'hand', index: 0 },
          buildPileIndex: 0,
        }),
      );
      expect(next.buildPiles[0].cards).toHaveLength(0);
      expect(next.buildPiles[0].direction).toBeNull();
      expect(next.completedBuildPiles).toHaveLength(12);
    });

    it('completed pile is recycled into drawPile when draw runs out during refill', () => {
      const state = makeTestState({
        players: [
          { id: 'p1', hand: [12], stock: [5] }, // hand empties after play, triggers refill
          { id: 'p2', stock: [5] },
        ],
        buildPiles: [
          { direction: 'asc', cards: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
        ],
        drawPile: [], // empty → refill-draw fires after pile completes
      });
      const next = ok(
        applyAction(state, {
          type: 'PLAY_TO_BUILD',
          source: { from: 'hand', index: 0 },
          buildPileIndex: 0,
        }),
      );
      expect(next.completedBuildPiles).toHaveLength(0);
      // 12 recycled into draw; actor drew up to handSize (5); remainder in draw
      expect(next.players[0].hand).toHaveLength(5);
      expect(next.drawPile).toHaveLength(7);
    });
  });

  describe('source: stock', () => {
    it('plays from own stock top and reveals next', () => {
      const state = makeTestState({
        players: [
          { id: 'p1', hand: [5], stock: [7, 1] }, // top is 1
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
      expect(next.players[0].stockPile).toHaveLength(1);
      expect(next.players[0].stockPile[0].value).toBe(7); // 7 now revealed
      expect(next.buildPiles[0].cards[0].value).toBe(1);
    });

    it('blocks playing from partner stock without permission', () => {
      const state = makeTestState({
        players: [
          { id: 'p1', hand: [], stock: [5] },
          { id: 'p2', stock: [1] },
        ],
        partnership: {
          enabled: true,
          teams: [['p1', 'p2']],
          allowPlayFromPartnerStock: false,
          allowPlayFromPartnerDiscard: false,
          allowDiscardToPartnerDiscard: false,
        },
      });
      const bad = applyAction(state, {
        type: 'PLAY_TO_BUILD',
        source: { from: 'stock', playerIndex: 1 },
        buildPileIndex: 0,
      });
      expect(bad.ok).toBe(false);
    });

    it('allows playing from partner stock with permission', () => {
      const state = makeTestState({
        players: [
          { id: 'p1', hand: [], stock: [5] },
          { id: 'p2', stock: [1] },
        ],
        partnership: {
          enabled: true,
          teams: [['p1', 'p2']],
          allowPlayFromPartnerStock: true,
          allowPlayFromPartnerDiscard: false,
          allowDiscardToPartnerDiscard: false,
        },
      });
      const next = ok(
        applyAction(state, {
          type: 'PLAY_TO_BUILD',
          source: { from: 'stock', playerIndex: 1 },
          buildPileIndex: 0,
        }),
      );
      expect(next.players[1].stockPile).toHaveLength(0);
    });
  });

  describe('source: discard', () => {
    it('plays top of own discard pile and reveals previous', () => {
      const state = makeTestState({
        players: [
          {
            id: 'p1',
            hand: [],
            stock: [5],
            discards: [[3, 1]], // pile 0: bottom 3, top 1
          },
          { id: 'p2', stock: [5] },
        ],
      });
      const next = ok(
        applyAction(state, {
          type: 'PLAY_TO_BUILD',
          source: { from: 'discard', playerIndex: 0, pileIndex: 0 },
          buildPileIndex: 0,
        }),
      );
      expect(next.players[0].discardPiles[0]).toHaveLength(1);
      expect(next.players[0].discardPiles[0][0].value).toBe(3);
      expect(next.buildPiles[0].cards[0].value).toBe(1);
    });

    it('rejects empty discard pile', () => {
      const state = makeTestState({
        players: [
          { id: 'p1', hand: [], stock: [5] },
          { id: 'p2', stock: [5] },
        ],
      });
      const bad = applyAction(state, {
        type: 'PLAY_TO_BUILD',
        source: { from: 'discard', playerIndex: 0, pileIndex: 2 },
        buildPileIndex: 0,
      });
      expect(bad.ok).toBe(false);
    });
  });

  describe('mid-turn hand refill', () => {
    it('playing the last hand card triggers auto-refill to handSize', () => {
      const state = makeTestState({
        handSize: 5,
        players: [
          { id: 'p1', hand: [1], stock: [5] },
          { id: 'p2', stock: [5] },
        ],
        drawPile: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      });
      const next = ok(
        applyAction(state, {
          type: 'PLAY_TO_BUILD',
          source: { from: 'hand', index: 0 },
          buildPileIndex: 0,
        }),
      );
      expect(next.players[0].hand).toHaveLength(5);
      expect(next.drawPile).toHaveLength(5);
    });
  });
});
