import type { GameAction, GameConfig, GameState, PartnershipRules, PlayerState, CardValue } from '@/lib/game/types';

export interface OpponentView {
  slotIndex: number;
  name: string;
  handCount: number;
  stockCount: number;
  stockTop: { id: string; value: CardValue } | null;
  discardPiles: { id: string; value: CardValue }[][];
}

// Wire config omits the shuffle seed (would reveal every opponent's hand) and
// rewrites partnership team memberships from engine player ids (which for
// humans are sessionIds) to slot indices. See `server/src/game/view.ts`.
export type PublicPartnershipRules = Omit<PartnershipRules, 'teams'> & {
  teams: number[][];
};
export type PublicGameConfig = Omit<GameConfig, 'seed' | 'partnership'> & {
  partnership: PublicPartnershipRules | null;
};

export type PublicPlayerState = Omit<PlayerState, 'id'>;

export interface PlayerView {
  config: PublicGameConfig;
  phase: GameState['phase'];
  turnPhase: GameState['turnPhase'];
  currentPlayerSlotIndex: number;
  youSlotIndex: number;
  winningTeamIndex: number | null;
  stateVersion: number;
  buildPiles: GameState['buildPiles'];
  drawPileCount: number;
  you: PublicPlayerState;
  opponents: OpponentView[];
}

export interface GameViewSeat {
  slotIndex: number;
  kind: 'human' | 'ai' | 'locked' | 'open';
  name: string | null;
  connected: boolean;
  graceDeadline: number | null;
  botControlled: boolean;
}

export interface GameView {
  view: PlayerView;
  seats: GameViewSeat[];
}

export type ClientMessage =
  | { type: 'action'; action: GameAction }
  | { type: 'chat'; text: string };

export type ServerMessage =
  | { type: 'hello';       stateVersion: number; view: GameView }
  | { type: 'state';       stateVersion: number; view: GameView }
  | { type: 'actionError'; reason: string; stateVersion: number }
  | { type: 'chat';        fromSlotIndex: number; fromName: string; text: string; sentAt: number }
  | { type: 'gameEnded';   stateVersion: number; view: GameView; reason: 'winner' | 'abandoned' };

export interface ChatEntry {
  fromSlotIndex: number;
  fromName: string;
  text: string;
  sentAt: number;
}

export const TERMINAL_CLOSE_CODES = new Set([4002, 4003, 4004, 4005]);
