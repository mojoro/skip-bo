import { describe, it, expect } from 'vitest';
import { buildSeatViewModels, type SeatViewModel } from './seat';
import type { GameView, GameViewSeat, PlayerView } from '@/lib/net/protocol';
import type { Card } from '@/lib/game/types';

const TEAM_COLORS = ['#aa0000', '#00aa00'];

function makeCard(id: string, value: Card['value']): Card {
  return { id, value };
}

function baseView(): PlayerView {
  return {
    config: {
      ruleset: 'recommended',
      stockPileSize: 15,
      handSize: 5,
      bidirectionalBuild: true,
      maxPlayers: 8,
      partnership: null,
    },
    phase: 'playing',
    turnPhase: 'play',
    currentPlayerSlotIndex: 0,
    youSlotIndex: 0,
    winningTeamIndex: null,
    stateVersion: 1,
    buildPiles: [],
    drawPileCount: 100,
    you: {
      name: 'Alice',
      hand: [makeCard('h1', 3), makeCard('h2', 7)],
      stockPile: [makeCard('s1', 5), makeCard('s2', 2)],
      discardPiles: [[], [makeCard('d1', 4)], [], []],
    },
    opponents: [
      {
        slotIndex: 1,
        name: 'Bob',
        handCount: 4,
        stockCount: 15,
        stockTop: { id: 's-bob', value: 9 },
        discardPiles: [[], [], [{ id: 'd-bob', value: 1 }], []],
      },
    ],
  };
}

function baseSeats(): GameViewSeat[] {
  return [
    { slotIndex: 0, kind: 'human', name: 'Alice', connected: true, graceDeadline: null, botControlled: false, isHost: true },
    { slotIndex: 1, kind: 'human', name: 'Bob', connected: true, graceDeadline: null, botControlled: false, isHost: false },
  ];
}

function build(view: PlayerView = baseView(), seats: GameViewSeat[] = baseSeats()): SeatViewModel[] {
  return buildSeatViewModels({ view, seats, teamColors: TEAM_COLORS });
}

describe('buildSeatViewModels', () => {
  it('produces one view model per seat in slot order', () => {
    const models = build();
    expect(models).toHaveLength(2);
    expect(models.map((m) => m.slotIndex)).toEqual([0, 1]);
  });

  it('marks the viewer seat isYou=true and attaches real hand cards', () => {
    const models = build();
    expect(models[0]!.isYou).toBe(true);
    expect(models[0]!.handCards).toEqual([
      { id: 'h1', value: 3 },
      { id: 'h2', value: 7 },
    ]);
    expect(models[0]!.handCount).toBe(2);
  });

  it('marks opponents isYou=false with null handCards and count from wire', () => {
    const models = build();
    expect(models[1]!.isYou).toBe(false);
    expect(models[1]!.handCards).toBeNull();
    expect(models[1]!.handCount).toBe(4);
  });

  it('marks the current player isActive', () => {
    const models = build();
    expect(models[0]!.isActive).toBe(true);
    expect(models[1]!.isActive).toBe(false);
  });

  it('derives stockTop/stockCount and discard piles for viewer and opponent', () => {
    const models = build();
    expect(models[0]!.stockTop).toEqual({ id: 's2', value: 2 });
    expect(models[0]!.stockCount).toBe(2);
    expect(models[0]!.discardPiles).toEqual([[], [{ id: 'd1', value: 4 }], [], []]);
    expect(models[1]!.stockTop).toEqual({ id: 's-bob', value: 9 });
    expect(models[1]!.stockCount).toBe(15);
    expect(models[1]!.discardPiles).toEqual([[], [], [{ id: 'd-bob', value: 1 }], []]);
  });

  it('derives presence: online for connected humans', () => {
    const models = build();
    expect(models[0]!.presence).toBe('online');
    expect(models[1]!.presence).toBe('online');
  });

  it('derives presence: offline for disconnected humans with no grace and no bot', () => {
    const seats = baseSeats();
    seats[1] = { ...seats[1]!, connected: false };
    const models = build(baseView(), seats);
    expect(models[1]!.presence).toBe('offline');
  });

  it('derives presence: grace when graceDeadline is set', () => {
    const seats = baseSeats();
    seats[1] = { ...seats[1]!, connected: false, graceDeadline: Date.now() + 10_000 };
    const models = build(baseView(), seats);
    expect(models[1]!.presence).toBe('grace');
  });

  it('derives presence: bot when botControlled', () => {
    const seats = baseSeats();
    seats[1] = { ...seats[1]!, connected: false, botControlled: true };
    const models = build(baseView(), seats);
    expect(models[1]!.presence).toBe('bot');
  });

  it('derives presence: ai when seat.kind is ai', () => {
    const seats = baseSeats();
    seats[1] = { slotIndex: 1, kind: 'ai', name: 'bot-x', connected: true, graceDeadline: null, botControlled: false, isHost: false };
    const models = build(baseView(), seats);
    expect(models[1]!.presence).toBe('ai');
  });

  it('derives presence: empty for open or locked seats', () => {
    const seats: GameViewSeat[] = [
      { slotIndex: 0, kind: 'human', name: 'Alice', connected: true, graceDeadline: null, botControlled: false, isHost: true },
      { slotIndex: 1, kind: 'open', name: null, connected: false, graceDeadline: null, botControlled: false, isHost: false },
      { slotIndex: 2, kind: 'locked', name: null, connected: false, graceDeadline: null, botControlled: false, isHost: false },
    ];
    const view = baseView();
    view.opponents = [];
    const models = build(view, seats);
    expect(models[1]!.presence).toBe('empty');
    expect(models[2]!.presence).toBe('empty');
  });

  it('resolves team membership from view.config.partnership.teams by slot index', () => {
    const view = baseView();
    view.config = {
      ...view.config,
      partnership: {
        enabled: true,
        teams: [[0], [1]],
        allowPlayFromPartnerStock: true,
        allowPlayFromPartnerDiscard: true,
        allowDiscardToPartnerDiscard: true,
      },
    };
    const models = build(view);
    expect(models[0]!.team).toEqual({ index: 0, color: TEAM_COLORS[0] });
    expect(models[1]!.team).toEqual({ index: 1, color: TEAM_COLORS[1] });
  });

  it('omits team when partnership is null', () => {
    const models = build();
    expect(models[0]!.team).toBeNull();
    expect(models[1]!.team).toBeNull();
  });

  it('flags isHost from seat.isHost', () => {
    const models = build();
    expect(models[0]!.isHost).toBe(true);
    expect(models[1]!.isHost).toBe(false);
  });

  it('renders a sensible fallback name for seats without a name', () => {
    const seats = baseSeats();
    seats[1] = { ...seats[1]!, kind: 'open', name: null };
    const view = baseView();
    view.opponents = [];
    const models = build(view, seats);
    expect(models[1]!.name).toBe('Empty seat');
  });
});
