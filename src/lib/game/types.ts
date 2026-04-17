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

export type GamePhase = 'waiting' | 'playing' | 'finished';
export type TurnPhase = 'play' | 'discard';

export interface GameState {
  phase: GamePhase;
  turnPhase: TurnPhase;
  drawPile: Card[];
  completedBuildPiles: Card[];
  buildPiles: BuildPile[];
  players: PlayerState[];
  currentPlayerIndex: number;
  winningTeamIndex: number | null;
  stateVersion: number;
}

export type CardSource =
  | { from: 'hand'; index: number }
  | { from: 'stock'; playerIndex: number }
  | { from: 'discard'; playerIndex: number; pileIndex: number };

export type GameAction =
  | {
      type: 'PLAY_TO_BUILD';
      source: CardSource;
      buildPileIndex: number;
      declaredDirection?: BuildDirection;
    }
  | { type: 'DISCARD'; handIndex: number; discardPileIndex: number; targetPlayerIndex: number };

export type ActionResult =
  | { ok: true; state: GameState }
  | { ok: false; error: string };
