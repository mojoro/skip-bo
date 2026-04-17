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

export type Ruleset = 'recommended' | 'official';

export interface PartnershipRules {
  enabled: boolean;
  teams: string[][];
  allowPlayFromPartnerStock: boolean;
  allowPlayFromPartnerDiscard: boolean;
  allowDiscardToPartnerDiscard: boolean;
}

export interface GameConfig {
  ruleset: Ruleset;
  stockPileSize: number;
  handSize: number;
  bidirectionalBuild: boolean;
  maxPlayers: number;
  partnership: PartnershipRules | null;
  seed?: number;
}

export interface GameState {
  config: GameConfig;
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

export const BUILD_PILE_COUNT = 4;
export const DISCARD_PILE_COUNT = 4;

export const CONFIG_LIMITS = {
  stockPileSize: { min: 5, max: 50 },
  handSize: { min: 3, max: 10 },
  maxPlayers: { min: 2, max: 8 },
} as const;

export function defaultConfigForRuleset(ruleset: Ruleset, playerCount: number): GameConfig {
  if (ruleset === 'recommended') {
    return {
      ruleset,
      stockPileSize: 15,
      handSize: 5,
      bidirectionalBuild: true,
      maxPlayers: 8,
      partnership: null,
    };
  }
  const officialStock =
    playerCount <= 4 ? 30 : playerCount <= 6 ? 20 : 10;
  return {
    ruleset,
    stockPileSize: officialStock,
    handSize: 5,
    bidirectionalBuild: false,
    maxPlayers: 8,
    partnership: null,
  };
}

export function defaultPartnershipRules(ruleset: Ruleset, teams: string[][]): PartnershipRules {
  return {
    enabled: true,
    teams,
    allowPlayFromPartnerStock: true,
    allowPlayFromPartnerDiscard: true,
    allowDiscardToPartnerDiscard: ruleset === 'recommended',
  };
}
