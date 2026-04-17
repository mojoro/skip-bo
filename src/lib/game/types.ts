export const WILD = 'WILD' as const;

export type CardValue = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | typeof WILD;

export interface Card {
  id: string;
  value: CardValue;
}

export type BuildDirection = 'asc' | 'desc' | null;

export interface BuildPile {
  cards: Card[];
  direction: BuildDirection;
}

export interface PlayerState {
  id: string;
  name: string;
  stockPile: Card[];
  hand: Card[];
  discardPiles: Card[][];
}
