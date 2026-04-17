import { describe, expect, it } from 'vitest';
import { createDeck, createShuffledDeck, DECK_TOTAL } from './deck';
import { mulberry32 } from './rng';
import { WILD } from './types';

describe('deck', () => {
  it('has 162 cards total', () => {
    expect(createDeck()).toHaveLength(162);
    expect(DECK_TOTAL).toBe(162);
  });

  it('contains 12 copies of each numbered card 1–12', () => {
    const counts = new Map<number | string, number>();
    for (const c of createDeck()) {
      counts.set(c.value, (counts.get(c.value) ?? 0) + 1);
    }
    for (let n = 1; n <= 12; n++) {
      expect(counts.get(n)).toBe(12);
    }
  });

  it('contains 18 wild cards', () => {
    const wilds = createDeck().filter((c) => c.value === WILD);
    expect(wilds).toHaveLength(18);
  });

  it('gives each card a unique id', () => {
    const ids = new Set(createDeck().map((c) => c.id));
    expect(ids.size).toBe(162);
  });

  it('preserves composition after shuffle', () => {
    const rng = mulberry32(42);
    const shuffled = createShuffledDeck(rng);
    expect(shuffled).toHaveLength(162);
    const ids = new Set(shuffled.map((c) => c.id));
    expect(ids.size).toBe(162);
  });

  it('shuffles deterministically with the same seed', () => {
    const a = createShuffledDeck(mulberry32(123));
    const b = createShuffledDeck(mulberry32(123));
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
  });

  it('produces different orderings with different seeds', () => {
    const a = createShuffledDeck(mulberry32(1));
    const b = createShuffledDeck(mulberry32(2));
    expect(a.map((c) => c.id)).not.toEqual(b.map((c) => c.id));
  });
});
