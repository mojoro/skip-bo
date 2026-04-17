import {
  BUILD_PILE_COUNT,
  BuildDirection,
  BuildPile,
  Card,
  CardSource,
  CONFIG_LIMITS,
  DISCARD_PILE_COUNT,
  GameAction,
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

function advanceTurn(state: GameState, rng: () => number): void {
  state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
  state.turnPhase = 'play';
  refillHand(state, state.currentPlayerIndex, rng);
}

function checkWin(state: GameState): void {
  const partnership = state.config.partnership;
  if (partnership && partnership.enabled) {
    for (let t = 0; t < partnership.teams.length; t++) {
      const allEmpty = partnership.teams[t].every((pid) => {
        const p = state.players.find((pp) => pp.id === pid);
        return !!p && p.stockPile.length === 0;
      });
      if (allEmpty) {
        state.phase = 'finished';
        state.winningTeamIndex = t;
        return;
      }
    }
    return;
  }
  for (let i = 0; i < state.players.length; i++) {
    if (state.players[i].stockPile.length === 0) {
      state.phase = 'finished';
      state.winningTeamIndex = i;
      return;
    }
  }
}

type ResolvedSource =
  | { ok: true; card: Card; remove: () => void }
  | { ok: false; error: string };

function resolveSource(
  state: GameState,
  actorIndex: number,
  source: CardSource,
): ResolvedSource {
  const actor = state.players[actorIndex];
  const partnership = state.config.partnership;

  if (source.from === 'hand') {
    if (source.index < 0 || source.index >= actor.hand.length) {
      return { ok: false, error: 'invalid hand index' };
    }
    const card = actor.hand[source.index];
    return { ok: true, card, remove: () => actor.hand.splice(source.index, 1) };
  }

  if (source.from === 'stock') {
    const ownerIdx = source.playerIndex;
    if (ownerIdx < 0 || ownerIdx >= state.players.length) {
      return { ok: false, error: 'invalid stock owner' };
    }
    const owner = state.players[ownerIdx];
    if (owner.stockPile.length === 0) return { ok: false, error: 'stock pile empty' };
    if (ownerIdx !== actorIndex) {
      if (!partnership?.allowPlayFromPartnerStock) {
        return { ok: false, error: 'playing from partner stock not allowed' };
      }
      if (!playersOnSameTeam(state, actorIndex, ownerIdx)) {
        return { ok: false, error: 'not on same team' };
      }
    }
    const card = owner.stockPile[owner.stockPile.length - 1];
    return { ok: true, card, remove: () => owner.stockPile.pop() };
  }

  const ownerIdx = source.playerIndex;
  if (ownerIdx < 0 || ownerIdx >= state.players.length) {
    return { ok: false, error: 'invalid discard owner' };
  }
  if (source.pileIndex < 0 || source.pileIndex >= DISCARD_PILE_COUNT) {
    return { ok: false, error: 'invalid discard pile index' };
  }
  const owner = state.players[ownerIdx];
  const pile = owner.discardPiles[source.pileIndex];
  if (pile.length === 0) return { ok: false, error: 'discard pile empty' };
  if (ownerIdx !== actorIndex) {
    if (!partnership?.allowPlayFromPartnerDiscard) {
      return { ok: false, error: 'playing from partner discard not allowed' };
    }
    if (!playersOnSameTeam(state, actorIndex, ownerIdx)) {
      return { ok: false, error: 'not on same team' };
    }
  }
  const card = pile[pile.length - 1];
  return { ok: true, card, remove: () => pile.pop() };
}

export function applyAction(
  state: GameState,
  action: GameAction,
): { ok: true; state: GameState } | { ok: false; error: string } {
  if (state.phase !== 'playing') {
    return { ok: false, error: 'game is not in playing phase' };
  }
  const next = cloneState(state);
  const actorIndex = next.currentPlayerIndex;
  const rng = mulberry32((next.config.seed ?? 0) + next.stateVersion + 1);

  if (action.type === 'PLAY_TO_BUILD') {
    if (action.buildPileIndex < 0 || action.buildPileIndex >= BUILD_PILE_COUNT) {
      return { ok: false, error: 'invalid build pile index' };
    }
    const source = resolveSource(next, actorIndex, action.source);
    if (!source.ok) return { ok: false, error: source.error };

    const pile = next.buildPiles[action.buildPileIndex];
    const check = canPlayCardOnPile(pile, source.card, next.config, action.declaredDirection);
    if (!check.ok) return { ok: false, error: check.error };

    source.remove();
    pile.cards.push(source.card);
    pile.direction = check.resolvedDirection;
    maybeCompletePile(next, action.buildPileIndex);

    if (next.players[actorIndex].hand.length === 0) {
      refillHand(next, actorIndex, rng);
    }

    checkWin(next);
    next.stateVersion += 1;
    return { ok: true, state: next };
  }

  if (action.type === 'DISCARD') {
    const actor = next.players[actorIndex];
    if (action.handIndex < 0 || action.handIndex >= actor.hand.length) {
      return { ok: false, error: 'invalid hand index' };
    }
    if (action.discardPileIndex < 0 || action.discardPileIndex >= DISCARD_PILE_COUNT) {
      return { ok: false, error: 'invalid discard pile index' };
    }
    const targetIdx = action.targetPlayerIndex;
    if (targetIdx < 0 || targetIdx >= next.players.length) {
      return { ok: false, error: 'invalid target player' };
    }
    if (targetIdx !== actorIndex) {
      const partnership = next.config.partnership;
      if (!partnership?.allowDiscardToPartnerDiscard) {
        return { ok: false, error: 'cannot discard to partner pile in this ruleset' };
      }
      if (!playersOnSameTeam(next, actorIndex, targetIdx)) {
        return { ok: false, error: 'target not on same team' };
      }
    }
    const [card] = actor.hand.splice(action.handIndex, 1);
    next.players[targetIdx].discardPiles[action.discardPileIndex].push(card);

    checkWin(next);
    if (next.phase === 'playing') advanceTurn(next, rng);
    next.stateVersion += 1;
    return { ok: true, state: next };
  }

  return { ok: false, error: 'unknown action type' };
}
