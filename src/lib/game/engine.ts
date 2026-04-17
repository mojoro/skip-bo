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
  WILD,
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

  const currentPlayerIndex =
    config.ruleset === 'official' ? 0 : pickStartingPlayerIndex(players, rng);

  return {
    config,
    phase: 'playing',
    turnPhase: 'play',
    drawPile: deck,
    completedBuildPiles: [],
    buildPiles,
    players,
    currentPlayerIndex,
    winningTeamIndex: null,
    stateVersion: 0,
  };
}

function pickStartingPlayerIndex(players: PlayerState[], rng: () => number): number {
  const stockValue = (p: PlayerState): number => {
    const top = p.stockPile[p.stockPile.length - 1];
    if (!top) return -1;
    return top.value === WILD ? 13 : top.value;
  };
  let bestValue = -1;
  let tied: number[] = [];
  for (let i = 0; i < players.length; i++) {
    const v = stockValue(players[i]);
    if (v > bestValue) {
      bestValue = v;
      tied = [i];
    } else if (v === bestValue) {
      tied.push(i);
    }
  }
  return tied[Math.floor(rng() * tied.length)];
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

function cloneState(state: GameState): GameState {
  return {
    config: state.config,
    phase: state.phase,
    turnPhase: state.turnPhase,
    drawPile: [...state.drawPile],
    completedBuildPiles: [...state.completedBuildPiles],
    buildPiles: state.buildPiles.map((b) => ({ cards: [...b.cards], direction: b.direction })),
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      stockPile: [...p.stockPile],
      hand: [...p.hand],
      discardPiles: p.discardPiles.map((d) => [...d]),
    })),
    currentPlayerIndex: state.currentPlayerIndex,
    winningTeamIndex: state.winningTeamIndex,
    stateVersion: state.stateVersion,
  };
}

function teamIndexOfPlayer(state: GameState, playerId: string): number | null {
  const teams = state.config.partnership?.teams;
  if (!teams) return null;
  for (let i = 0; i < teams.length; i++) {
    if (teams[i].includes(playerId)) return i;
  }
  return null;
}

function playersOnSameTeam(state: GameState, aIdx: number, bIdx: number): boolean {
  if (aIdx === bIdx) return true;
  const pa = state.players[aIdx];
  const pb = state.players[bIdx];
  const ta = teamIndexOfPlayer(state, pa.id);
  const tb = teamIndexOfPlayer(state, pb.id);
  return ta !== null && tb !== null && ta === tb;
}
