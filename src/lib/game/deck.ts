import { Card, CardValue, WILD } from './types';
import { Rng, shuffleInPlace } from './rng';

export const DECK_COPIES_OF_EACH_NUMBER = 12;
export const DECK_WILD_COUNT = 18;
export const DECK_TOTAL = 12 * DECK_COPIES_OF_EACH_NUMBER + DECK_WILD_COUNT;

export function createDeck(): Card[] {
  const cards: Card[] = [];
  let serial = 0;
  for (let value = 1 as CardValue; (value as number) <= 12; value = ((value as number) + 1) as CardValue) {
    for (let i = 0; i < DECK_COPIES_OF_EACH_NUMBER; i++) {
      cards.push({ id: `c${serial++}`, value });
    }
  }
  for (let i = 0; i < DECK_WILD_COUNT; i++) {
    cards.push({ id: `c${serial++}`, value: WILD });
  }
  return cards;
}

export function createShuffledDeck(rng: Rng): Card[] {
  return shuffleInPlace(createDeck(), rng);
}
