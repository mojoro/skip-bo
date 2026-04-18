import type { GameAction, GameState, PlayerState, CardValue } from '@/lib/game/types';

export interface OpponentView {
  id: string;
  name: string;
  handCount: number;
  stockCount: number;
  stockTop: { id: string; value: CardValue } | null;
  discardPiles: { id: string; value: CardValue }[][];
}

export interface PlayerView {
  config: GameState['config'];
  phase: GameState['phase'];
  turnPhase: GameState['turnPhase'];
  currentPlayerIndex: number;
  winningTeamIndex: number | null;
  stateVersion: number;
  buildPiles: GameState['buildPiles'];
  drawPileCount: number;
  youIndex: number;
  you: PlayerState;
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
