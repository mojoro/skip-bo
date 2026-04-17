import { describe, expect, it } from 'vitest';
import { createGame } from './engine';

const makePlayers = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));

describe('createGame', () => {
  it('rejects fewer than 2 players', () => {
    expect(() => createGame({ players: makePlayers(1) })).toThrow();
  });

  it('rejects more than 8 players', () => {
    expect(() => createGame({ players: makePlayers(9) })).toThrow();
  });

  it('deals stock piles of configured size', () => {
    const game = createGame({ players: makePlayers(3), seed: 1 });
    for (const p of game.players) {
      expect(p.stockPile).toHaveLength(game.config.stockPileSize);
    }
  });

  it('deals hands of configured size', () => {
    const game = createGame({ players: makePlayers(3), seed: 1 });
    for (const p of game.players) {
      expect(p.hand).toHaveLength(game.config.handSize);
    }
  });

  it('defaults recommended ruleset to bidirectional + stock 15 + hand 5', () => {
    const game = createGame({ players: makePlayers(2) });
    expect(game.config.ruleset).toBe('recommended');
    expect(game.config.bidirectionalBuild).toBe(true);
    expect(game.config.stockPileSize).toBe(15);
    expect(game.config.handSize).toBe(5);
  });

  it('defaults official ruleset to asc-only + scaling stock', () => {
    const sixP = createGame({ players: makePlayers(6), ruleset: 'official' });
    expect(sixP.config.bidirectionalBuild).toBe(false);
    expect(sixP.config.stockPileSize).toBe(20);

    const twoP = createGame({ players: makePlayers(2), ruleset: 'official' });
    expect(twoP.config.stockPileSize).toBe(30);

    const eightP = createGame({ players: makePlayers(8), ruleset: 'official' });
    expect(eightP.config.stockPileSize).toBe(10);
  });

  it('allows overriding stock + hand within limits', () => {
    const game = createGame({
      players: makePlayers(2),
      overrides: { stockPileSize: 7, handSize: 4 },
    });
    expect(game.config.stockPileSize).toBe(7);
    expect(game.config.handSize).toBe(4);
    for (const p of game.players) {
      expect(p.stockPile).toHaveLength(7);
      expect(p.hand).toHaveLength(4);
    }
  });

  it('rejects overrides outside limits', () => {
    expect(() =>
      createGame({ players: makePlayers(2), overrides: { stockPileSize: 1 } }),
    ).toThrow();
    expect(() =>
      createGame({ players: makePlayers(2), overrides: { handSize: 99 } }),
    ).toThrow();
  });

  it('records a draw pile with the remainder of the deck', () => {
    const game = createGame({ players: makePlayers(4), seed: 99 });
    const dealtPerPlayer = game.config.stockPileSize + game.config.handSize;
    expect(game.drawPile).toHaveLength(162 - dealtPerPlayer * 4);
  });

  it('is deterministic with the same seed', () => {
    const a = createGame({ players: makePlayers(3), seed: 555 });
    const b = createGame({ players: makePlayers(3), seed: 555 });
    expect(a.players.map((p) => p.hand.map((c) => c.id))).toEqual(
      b.players.map((p) => p.hand.map((c) => c.id)),
    );
    expect(a.drawPile.map((c) => c.id)).toEqual(b.drawPile.map((c) => c.id));
  });

  describe('partnership', () => {
    it('rejects partnership with odd player count', () => {
      expect(() =>
        createGame({
          players: makePlayers(3),
          partnership: {
            enabled: true,
            teams: [['p1', 'p2'], ['p3']],
            allowPlayFromPartnerStock: true,
            allowPlayFromPartnerDiscard: true,
            allowDiscardToPartnerDiscard: true,
          },
        }),
      ).toThrow();
    });

    it('accepts partnership with even player count', () => {
      const game = createGame({
        players: makePlayers(4),
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
      expect(game.config.partnership?.enabled).toBe(true);
      expect(game.config.partnership?.teams).toHaveLength(2);
    });
  });

  describe('first player', () => {
    it('official ruleset picks seat 0', () => {
      const game = createGame({
        players: makePlayers(5),
        ruleset: 'official',
        seed: 7,
      });
      expect(game.currentPlayerIndex).toBe(0);
    });

    it('recommended picks the player with highest top-stock (deterministic with seed)', () => {
      const game = createGame({ players: makePlayers(4), seed: 1234 });
      const topValue = (p: (typeof game.players)[number]) => {
        const t = p.stockPile[p.stockPile.length - 1];
        return t.value === 'WILD' ? 13 : (t.value as number);
      };
      const chosenValue = topValue(game.players[game.currentPlayerIndex]);
      const maxValue = Math.max(...game.players.map(topValue));
      expect(chosenValue).toBe(maxValue);
    });
  });
});
