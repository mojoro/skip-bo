import type { GameConfig, GameState } from '@engine/types';

export type RoomPhase = 'waiting' | 'playing' | 'finished';
export type Visibility = 'public' | 'private';

export type Slot =
  | { kind: 'open' }
  | { kind: 'locked' }
  | {
      kind: 'human';
      sessionId: string;
      name: string;
      connected: boolean;
      joinedAt: number;
      graceDeadline: number | null;
      graceTimer: NodeJS.Timeout | null;
      botControlled: boolean;
    }
  | { kind: 'ai'; botId: string; difficulty: 'easy' };

export interface Room {
  id: string;
  code: string;
  displayName: string;
  visibility: Visibility;
  phase: RoomPhase;
  hostSessionId: string;
  config: GameConfig;
  allowAiFill: boolean;
  slots: Slot[];
  game: GameState | null;
  createdAt: number;
  lastActivityAt: number;
  finishedAt: number | null;
  kickedSessionIds: Set<string>;
  idleTimer: NodeJS.Timeout | null;
  cleanupTimer: NodeJS.Timeout | null;
  botPending: Set<number>;
}

export interface RoomInfo {
  id: string;
  code: string | null;
  displayName: string;
  phase: RoomPhase;
  config: GameConfig;
  allowAiFill: boolean;
  visibility: Visibility;
  slotSummary: {
    humans: number;
    ai: number;
    open: number;
    locked: number;
    capacity: number;
  };
  hostName: string;
  createdAt: number;
}

export interface LobbyStats {
  gamesInProgress: number;
  playersOnline: number;
}

export type LobbyEvent =
  | { type: 'snapshot'; rooms: RoomInfo[]; stats: LobbyStats }
  | { type: 'roomAdded'; room: RoomInfo }
  | { type: 'roomUpdated'; room: RoomInfo }
  | { type: 'roomRemoved'; roomId: string }
  | { type: 'statsUpdate'; stats: LobbyStats };

export type FinishReason = 'winner' | 'abandoned' | 'playerGone';
