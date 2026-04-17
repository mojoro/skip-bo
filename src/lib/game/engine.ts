import {
  BUILD_PILE_COUNT,
  BuildDirection,
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
import { mulberry32, randomSeed, shuffleInPlace } from './rng';

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

function nextRequiredValueForPile(pile: BuildPile): number | null {
  if (pile.cards.length === 0 || pile.direction === null) return null;
  if (pile.direction === 'asc') return pile.cards.length + 1;
  return 12 - pile.cards.length;
}

function canPlayCardOnPile(
  pile: BuildPile,
  card: Card,
  config: GameConfig,
  declaredDirection: BuildDirection | undefined,
): { ok: true; resolvedDirection: BuildDirection } | { ok: false; error: string } {
  if (pile.cards.length === 0 || pile.direction === null) {
    if (card.value === WILD) {
      if (config.bidirectionalBuild) {
        if (declaredDirection !== 'asc' && declaredDirection !== 'desc') {
          return {
            ok: false,
            error: 'declare direction when playing wild on empty bidirectional pile',
          };
        }
        return { ok: true, resolvedDirection: declaredDirection };
      }
      return { ok: true, resolvedDirection: 'asc' };
    }
    if (card.value === 1) return { ok: true, resolvedDirection: 'asc' };
    if (card.value === 12 && config.bidirectionalBuild) {
      return { ok: true, resolvedDirection: 'desc' };
    }
    if (card.value === 12 && !config.bidirectionalBuild) {
      return { ok: false, error: 'descending piles not allowed in official rules' };
    }
    return { ok: false, error: `empty pile must start with 1${config.bidirectionalBuild ? ' or 12' : ''} (or wild)` };
  }
  const required = nextRequiredValueForPile(pile);
  if (required === null) {
    return { ok: false, error: 'pile state invalid' };
  }
  if (card.value === WILD) return { ok: true, resolvedDirection: pile.direction };
  if (card.value === required) return { ok: true, resolvedDirection: pile.direction };
  return { ok: false, error: `pile requires ${required}, card is ${card.value}` };
}

function refillDrawPileIfEmpty(state: GameState, rng: () => number): void {
  if (state.drawPile.length > 0) return;
  if (state.completedBuildPiles.length === 0) return;
  state.drawPile = shuffleInPlace([...state.completedBuildPiles], rng);
  state.completedBuildPiles = [];
}

function drawFromPile(state: GameState, rng: () => number): Card | null {
  if (state.drawPile.length === 0) refillDrawPileIfEmpty(state, rng);
  return state.drawPile.shift() ?? null;
}

function refillHand(state: GameState, playerIndex: number, rng: () => number): void {
  const p = state.players[playerIndex];
  while (p.hand.length < state.config.handSize) {
    const card = drawFromPile(state, rng);
    if (!card) break;
    p.hand.push(card);
  }
}

function maybeCompletePile(state: GameState, buildPileIndex: number): void {
  const pile = state.buildPiles[buildPileIndex];
  if (pile.cards.length === 12) {
    state.completedBuildPiles.push(...pile.cards);
    state.buildPiles[buildPileIndex] = { cards: [], direction: null };
  }
}
