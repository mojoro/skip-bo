import type { Card, CardValue } from '@/lib/game/types';
import type { GameViewSeat, OpponentView, PlayerView } from '@/lib/net/protocol';

export interface CardLite {
  id: string;
  value: CardValue;
}

export type SeatPresence =
  | 'online'
  | 'offline'
  | 'grace'
  | 'bot'
  | 'ai'
  | 'empty';

export interface SeatViewModel {
  slotIndex: number;
  name: string;
  handCards: Card[] | null;
  handCount: number;
  stockTop: CardLite | null;
  stockCount: number;
  discardPiles: CardLite[][];
  team: { index: number; color: string } | null;
  isActive: boolean;
  isYou: boolean;
  isHost: boolean;
  presence: SeatPresence;
}

export interface BuildSeatViewModelsArgs {
  view: PlayerView;
  seats: GameViewSeat[];
  teamColors: readonly string[];
}

export function buildSeatViewModels(args: BuildSeatViewModelsArgs): SeatViewModel[] {
  const { view, seats, teamColors } = args;
  const opponents = new Map<number, OpponentView>();
  for (const op of view.opponents) opponents.set(op.slotIndex, op);

  return seats.map((seat) => {
    const isYou = seat.slotIndex === view.youSlotIndex;
    const isActive = seat.slotIndex === view.currentPlayerSlotIndex;
    const team = teamFor(view, seat.slotIndex, teamColors);
    const presence = presenceOf(seat);

    if (isYou) {
      const stock = view.you.stockPile;
      return {
        slotIndex: seat.slotIndex,
        name: seat.name ?? view.you.name ?? 'You',
        handCards: view.you.hand,
        handCount: view.you.hand.length,
        stockTop: stock.length > 0 ? { id: stock[stock.length - 1]!.id, value: stock[stock.length - 1]!.value } : null,
        stockCount: stock.length,
        discardPiles: view.you.discardPiles.map((pile) => pile.map((c) => ({ id: c.id, value: c.value }))),
        team,
        isActive,
        isYou: true,
        isHost: seat.isHost,
        presence,
      };
    }

    const opponent = opponents.get(seat.slotIndex);
    if (opponent) {
      return {
        slotIndex: seat.slotIndex,
        name: seat.name ?? opponent.name ?? fallbackName(seat),
        handCards: null,
        handCount: opponent.handCount,
        stockTop: opponent.stockTop,
        stockCount: opponent.stockCount,
        discardPiles: opponent.discardPiles,
        team,
        isActive,
        isYou: false,
        isHost: seat.isHost,
        presence,
      };
    }

    // Empty / locked / ai with no corresponding OpponentView entry.
    return {
      slotIndex: seat.slotIndex,
      name: seat.name ?? fallbackName(seat),
      handCards: null,
      handCount: 0,
      stockTop: null,
      stockCount: 0,
      discardPiles: [[], [], [], []],
      team,
      isActive,
      isYou: false,
      isHost: seat.isHost,
      presence,
    };
  });
}

function teamFor(view: PlayerView, slotIndex: number, colors: readonly string[]): SeatViewModel['team'] {
  const partnership = view.config.partnership;
  if (!partnership) return null;
  for (let i = 0; i < partnership.teams.length; i++) {
    if (partnership.teams[i]!.includes(slotIndex)) {
      return { index: i, color: colors[i % colors.length]! };
    }
  }
  return null;
}

function presenceOf(seat: GameViewSeat): SeatPresence {
  if (seat.kind === 'ai') return 'ai';
  if (seat.kind === 'open' || seat.kind === 'locked') return 'empty';
  if (seat.botControlled) return 'bot';
  if (seat.graceDeadline !== null) return 'grace';
  if (seat.connected) return 'online';
  return 'offline';
}

function fallbackName(seat: GameViewSeat): string {
  if (seat.kind === 'open' || seat.kind === 'locked') return 'Empty seat';
  return 'Player';
}
