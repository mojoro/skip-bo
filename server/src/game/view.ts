import type { OpponentView, PlayerView } from '@engine/engine';
import { getPlayerView } from '@engine/engine';
import type { Card, GameConfig, PartnershipRules, PlayerState, BuildPile, GamePhase, TurnPhase } from '@engine/types';
import type { Room, Slot } from '../types';
import { slotIndexForPlayerId } from './mapping';

export interface GameViewSeat {
  slotIndex: number;
  kind: Slot['kind'];
  name: string | null;
  connected: boolean;
  graceDeadline: number | null;
  botControlled: boolean;
}

export type PublicPartnershipRules = Omit<PartnershipRules, 'teams'> & {
  teams: number[][];
};

export type PublicGameConfig = Omit<GameConfig, 'seed' | 'partnership'> & {
  partnership: PublicPartnershipRules | null;
};

export interface PublicOpponentView {
  slotIndex: number;
  name: string;
  handCount: number;
  stockCount: number;
  stockTop: Card | null;
  discardPiles: Card[][];
}

export type PublicPlayerState = Omit<PlayerState, 'id' | 'name'> & {
  name: string;
};

export interface PublicPlayerView {
  config: PublicGameConfig;
  phase: GamePhase;
  turnPhase: TurnPhase;
  currentPlayerSlotIndex: number;
  youSlotIndex: number;
  winningTeamIndex: number | null;
  stateVersion: number;
  buildPiles: BuildPile[];
  drawPileCount: number;
  you: PublicPlayerState;
  opponents: PublicOpponentView[];
}

export interface GameView {
  view: PublicPlayerView;
  seats: GameViewSeat[];
}

function publicizeConfig(room: Room, config: GameConfig): PublicGameConfig {
  // `config.seed` drives the shuffle + per-action RNG — exposing it lets any
  // client reconstruct every opponent's hidden hand/stock. Partnership teams
  // store engine player ids, which for humans are sessionIds; broadcasting
  // them hands an attacker the keys to take over any seat on reconnect.
  const { seed: _seed, partnership, ...rest } = config;
  let publicPartnership: PublicPartnershipRules | null = null;
  if (partnership) {
    publicPartnership = {
      ...partnership,
      teams: partnership.teams.map((team: string[]) =>
        team.map((id: string) => slotIndexForPlayerId(room, id)),
      ),
    };
  }
  return { ...rest, partnership: publicPartnership };
}

function publicizeOpponents(room: Room, raw: OpponentView[]): PublicOpponentView[] {
  return raw.map((op) => {
    const { id: _id, ...rest } = op;
    return { ...rest, slotIndex: slotIndexForPlayerId(room, op.id) };
  });
}

export function buildSeats(room: Room): GameViewSeat[] {
  return room.slots.map((slot, slotIndex) => {
    switch (slot.kind) {
      case 'human':
        return {
          slotIndex,
          kind: 'human',
          name: slot.name,
          connected: slot.connected,
          graceDeadline: slot.graceDeadline,
          botControlled: slot.botControlled,
        };
      case 'ai':
        return {
          slotIndex,
          kind: 'ai',
          name: slot.botId,
          connected: true,
          graceDeadline: null,
          botControlled: false,
        };
      case 'open':
        return {
          slotIndex,
          kind: 'open',
          name: null,
          connected: false,
          graceDeadline: null,
          botControlled: false,
        };
      case 'locked':
        return {
          slotIndex,
          kind: 'locked',
          name: null,
          connected: false,
          graceDeadline: null,
          botControlled: false,
        };
    }
  });
}

export function buildGameView(room: Room, sessionId: string, seats?: GameViewSeat[]): GameView {
  if (!room.game) throw new Error('buildGameView: room has no game');
  const raw = getPlayerView(room.game, sessionId);
  // Drop the viewer's own sessionId from `you.id` — the client already holds
  // it, and stripping here keeps broadcast payloads (and any server-side logs
  // that capture them) free of the identifier that authenticates the seat.
  const { id: _id, ...youRest } = raw.you;
  const currentPlayer = room.game.players[raw.currentPlayerIndex];
  const currentPlayerSlotIndex = currentPlayer
    ? slotIndexForPlayerId(room, currentPlayer.id)
    : -1;
  const youSlotIndex = slotIndexForPlayerId(room, raw.you.id);
  const view: PublicPlayerView = {
    config: publicizeConfig(room, raw.config),
    phase: raw.phase,
    turnPhase: raw.turnPhase,
    currentPlayerSlotIndex,
    youSlotIndex,
    winningTeamIndex: raw.winningTeamIndex,
    stateVersion: raw.stateVersion,
    buildPiles: raw.buildPiles,
    drawPileCount: raw.drawPileCount,
    you: youRest,
    opponents: publicizeOpponents(room, raw.opponents),
  };
  return { view, seats: seats ?? buildSeats(room) };
}
