import { describe, expect, it } from 'vitest';
import { getPlayerView } from './engine';
import { makeTestState } from './testHelpers';

describe('getPlayerView', () => {
  it('exposes the viewer their own full hand and stock', () => {
    const state = makeTestState({
      players: [
        { id: 'p1', hand: [2, 3, 4], stock: [5, 7, 9] },
        { id: 'p2', stock: [5] },
      ],
    });
    const view = getPlayerView(state, 'p1');
    expect(view.you.hand.map((c) => c.value)).toEqual([2, 3, 4]);
    expect(view.you.stockPile.map((c) => c.value)).toEqual([5, 7, 9]);
    expect(view.youIndex).toBe(0);
  });

  it('hides opponent hand contents but not count', () => {
    const state = makeTestState({
      players: [
        { id: 'p1', hand: [1, 2], stock: [3] },
        { id: 'p2', hand: [5, 6, 7], stock: [4] },
      ],
    });
    const view = getPlayerView(state, 'p1');
    const opp = view.opponents[0];
    expect(opp.handCount).toBe(3);
    expect((opp as unknown as { hand?: unknown }).hand).toBeUndefined();
  });

  it('exposes opponent top-of-stock but hides rest of stock', () => {
    const state = makeTestState({
      players: [
        { id: 'p1', hand: [], stock: [3] },
        { id: 'p2', stock: [1, 2, 9] }, // top is 9
      ],
    });
    const view = getPlayerView(state, 'p1');
    const opp = view.opponents[0];
    expect(opp.stockCount).toBe(3);
    expect(opp.stockTop?.value).toBe(9);
    expect((opp as unknown as { stockPile?: unknown }).stockPile).toBeUndefined();
  });

  it('returns null stockTop when opponent stock empty', () => {
    const state = makeTestState({
      players: [
        { id: 'p1', hand: [], stock: [3] },
        { id: 'p2', stock: [] },
      ],
    });
    const view = getPlayerView(state, 'p1');
    expect(view.opponents[0].stockTop).toBeNull();
    expect(view.opponents[0].stockCount).toBe(0);
  });

  it('exposes opponent discard piles in full (public info)', () => {
    const state = makeTestState({
      players: [
        { id: 'p1', hand: [], stock: [3] },
        {
          id: 'p2',
          stock: [5],
          discards: [
            [1, 2],
            [3],
          ],
        },
      ],
    });
    const view = getPlayerView(state, 'p1');
    expect(view.opponents[0].discardPiles[0].map((c) => c.value)).toEqual([1, 2]);
    expect(view.opponents[0].discardPiles[1].map((c) => c.value)).toEqual([3]);
  });

  it('exposes drawPileCount but not drawPile cards', () => {
    const state = makeTestState({
      players: [
        { id: 'p1', hand: [], stock: [3] },
        { id: 'p2', stock: [5] },
      ],
      drawPile: [1, 2, 3, 4, 5, 6, 7],
    });
    const view = getPlayerView(state, 'p1');
    expect(view.drawPileCount).toBe(7);
    expect((view as unknown as { drawPile?: unknown }).drawPile).toBeUndefined();
  });

  it('throws for unknown playerId', () => {
    const state = makeTestState({
      players: [
        { id: 'p1', stock: [5] },
        { id: 'p2', stock: [5] },
      ],
    });
    expect(() => getPlayerView(state, 'nobody')).toThrow();
  });

  it('returns a deep copy — mutating view does not affect state', () => {
    const state = makeTestState({
      players: [
        { id: 'p1', hand: [3], stock: [5] },
        { id: 'p2', stock: [5] },
      ],
    });
    const view = getPlayerView(state, 'p1');
    view.you.hand.push({ id: 'x', value: 9 });
    view.buildPiles[0].cards.push({ id: 'y', value: 1 });
    expect(state.players[0].hand).toHaveLength(1);
    expect(state.buildPiles[0].cards).toHaveLength(0);
  });
});
