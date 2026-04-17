import {
  BUILD_PILE_COUNT,
  BuildPile,
  Card,
  CONFIG_LIMITS,
  DISCARD_PILE_COUNT,
  GameConfig,
  GameState,
  PlayerState,
  Ruleset,
  defaultConfigForRuleset,
} from './types';
import { createShuffledDeck } from './deck';
import { mulberry32, randomSeed } from './rng';

export interface CreateGameInput {
  players: { id: string; name: string }[];
  ruleset?: Ruleset;
  overrides?: Partial<Omit<GameConfig, 'ruleset' | 'partnership'>>;
  partnership?: GameConfig['partnership'];
  seed?: number;
}

export function createGame(input: CreateGameInput): GameState {
  const playerCount = input.players.length;
  if (playerCount < 2 || playerCount > 8) {
    throw new Error(`player count must be 2..8, got ${playerCount}`);
  }
  const ruleset = input.ruleset ?? 'recommended';
  const baseConfig = defaultConfigForRuleset(ruleset, playerCount);
  const config: GameConfig = { ...baseConfig, ...input.overrides, ruleset };
  validateConfig(config);

  if (input.partnership && playerCount % 2 !== 0) {
    throw new Error('partnership requires even player count');
  }
  config.partnership = input.partnership ?? null;

  const seed = input.seed ?? randomSeed();
  config.seed = seed;
  const rng = mulberry32(seed);
  const deck = createShuffledDeck(rng);

  const players: PlayerState[] = input.players.map((p) => ({
    id: p.id,
    name: p.name,
    stockPile: deck.splice(0, config.stockPileSize),
    hand: [],
    discardPiles: Array.from({ length: DISCARD_PILE_COUNT }, () => [] as Card[]),
  }));
  for (const p of players) {
    p.hand = deck.splice(0, config.handSize);
  }

  const buildPiles: BuildPile[] = Array.from({ length: BUILD_PILE_COUNT }, () => ({
    cards: [],
    direction: null,
  }));

  return {
    config,
    phase: 'playing',
    turnPhase: 'play',
    drawPile: deck,
    completedBuildPiles: [],
    buildPiles,
    players,
    currentPlayerIndex: 0,
    winningTeamIndex: null,
    stateVersion: 0,
  };
}

function validateConfig(config: GameConfig): void {
  const limits = CONFIG_LIMITS;
  if (
    config.stockPileSize < limits.stockPileSize.min ||
    config.stockPileSize > limits.stockPileSize.max
  ) {
    throw new Error(`stockPileSize out of range`);
  }
  if (config.handSize < limits.handSize.min || config.handSize > limits.handSize.max) {
    throw new Error(`handSize out of range`);
  }
  if (config.maxPlayers < limits.maxPlayers.min || config.maxPlayers > limits.maxPlayers.max) {
    throw new Error(`maxPlayers out of range`);
  }
}
