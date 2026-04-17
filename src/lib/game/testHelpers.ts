import {
  BUILD_PILE_COUNT,
  BuildDirection,
  BuildPile,
  Card,
  CardValue,
  DISCARD_PILE_COUNT,
  GameConfig,
  GameState,
  PartnershipRules,
  PlayerState,
  Ruleset,
  WILD,
  defaultConfigForRuleset,
} from './types';

export interface TestPlayerSpec {
  id: string;
  name?: string;
  hand?: CardValue[];
  stock?: CardValue[];
  discards?: CardValue[][];
}

export interface TestBuildPileSpec {
  direction: BuildDirection;
  cards: CardValue[];
}

export interface TestStateOptions {
  ruleset?: Ruleset;
  bidirectional?: boolean;
  handSize?: number;
  stockPileSize?: number;
  partnership?: PartnershipRules | null;
  players: TestPlayerSpec[];
  buildPiles?: TestBuildPileSpec[];
  drawPile?: CardValue[];
  completedBuildPiles?: CardValue[];
  currentPlayerIndex?: number;
}

let testCardSerial = 0;
function c(value: CardValue): Card {
  return { id: `t${testCardSerial++}`, value };
}

function padBuildPile(spec: TestBuildPileSpec): BuildPile {
  return { direction: spec.direction, cards: spec.cards.map(c) };
}

function padPlayer(spec: TestPlayerSpec): PlayerState {
  return {
    id: spec.id,
    name: spec.name ?? spec.id,
    hand: (spec.hand ?? []).map(c),
    stockPile: (spec.stock ?? []).map(c),
    discardPiles: (() => {
      const piles: Card[][] = Array.from({ length: DISCARD_PILE_COUNT }, () => []);
      (spec.discards ?? []).forEach((pileVals, i) => {
        if (i < DISCARD_PILE_COUNT) piles[i] = pileVals.map(c);
      });
      return piles;
    })(),
  };
}

export function makeTestState(options: TestStateOptions): GameState {
  const ruleset = options.ruleset ?? 'recommended';
  const base = defaultConfigForRuleset(ruleset, options.players.length);
  const config: GameConfig = {
    ...base,
    bidirectionalBuild: options.bidirectional ?? base.bidirectionalBuild,
    handSize: options.handSize ?? base.handSize,
    stockPileSize: options.stockPileSize ?? base.stockPileSize,
    partnership: options.partnership ?? null,
    seed: 1,
  };

  const buildPiles: BuildPile[] = Array.from(
    { length: BUILD_PILE_COUNT },
    (_, i) => options.buildPiles?.[i] ? padBuildPile(options.buildPiles[i]) : { cards: [], direction: null },
  );

  return {
    config,
    phase: 'playing',
    turnPhase: 'play',
    drawPile: (options.drawPile ?? []).map(c),
    completedBuildPiles: (options.completedBuildPiles ?? []).map(c),
    buildPiles,
    players: options.players.map(padPlayer),
    currentPlayerIndex: options.currentPlayerIndex ?? 0,
    winningTeamIndex: null,
    stateVersion: 0,
  };
}

export { WILD };
