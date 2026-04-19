import type { GameConfig, GameState, PartnershipRules } from '@/lib/game/types';
import type {
  GameView,
  GameViewSeat,
  OpponentView,
  PlayerView,
  PublicGameConfig,
  PublicPartnershipRules,
} from '@/lib/net/protocol';

export function engineStateToView(state: GameState, youPlayerIndex: number): GameView & { view: PlayerView } {
  const players = state.players;
  const you = players[youPlayerIndex];
  if (!you) {
    throw new Error(`engineStateToView: youPlayerIndex ${youPlayerIndex} out of range`);
  }

  const opponents: OpponentView[] = players
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => i !== youPlayerIndex)
    .map(({ p, i }) => {
      const top = p.stockPile[p.stockPile.length - 1] ?? null;
      return {
        slotIndex: i,
        name: p.name,
        handCount: p.hand.length,
        stockCount: p.stockPile.length,
        stockTop: top ? { id: top.id, value: top.value } : null,
        discardPiles: p.discardPiles.map((pile) => pile.map((c) => ({ id: c.id, value: c.value }))),
      };
    });

  const view: PlayerView = {
    config: publicizeConfig(state.config, players),
    phase: state.phase,
    turnPhase: state.turnPhase,
    currentPlayerSlotIndex: state.currentPlayerIndex,
    youSlotIndex: youPlayerIndex,
    winningTeamIndex: state.winningTeamIndex,
    stateVersion: state.stateVersion,
    buildPiles: state.buildPiles,
    drawPileCount: state.drawPile.length,
    you: {
      name: you.name,
      hand: you.hand,
      stockPile: you.stockPile,
      discardPiles: you.discardPiles,
    },
    opponents,
  };

  const seats: GameViewSeat[] = players.map((p, i) => ({
    slotIndex: i,
    kind: 'human',
    name: p.name,
    connected: true,
    graceDeadline: null,
    botControlled: false,
    isHost: i === youPlayerIndex,
  }));

  return { view, seats, hostSlotIndex: null };
}

function publicizeConfig(config: GameConfig, players: GameState['players']): PublicGameConfig {
  // Deliberately omit `seed` — the wire shape must never expose it because it
  // would let any client re-roll the RNG and reconstruct every opponent's
  // hidden state. Drop via destructuring so an accidental addition surfaces
  // as a typecheck error in the future.
  const { seed: _seed, partnership, ...rest } = config;
  return {
    ...rest,
    partnership: partnership ? publicizePartnership(partnership, players) : null,
  };
}

function publicizePartnership(
  partnership: PartnershipRules,
  players: GameState['players'],
): PublicPartnershipRules {
  const idToSlot = new Map<string, number>();
  players.forEach((p, i) => idToSlot.set(p.id, i));
  return {
    ...partnership,
    teams: partnership.teams.map((team) =>
      team.map((id) => {
        const slot = idToSlot.get(id);
        if (slot === undefined) {
          throw new Error(`publicizePartnership: player id "${id}" not found in players array`);
        }
        return slot;
      })
    ),
  };
}
