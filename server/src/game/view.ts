import type { PlayerView } from '@engine/engine';
import { getPlayerView } from '@engine/engine';
import type { GameConfig } from '@engine/types';
import type { Room, Slot } from '../types';

export interface GameViewSeat {
  slotIndex: number;
  kind: Slot['kind'];
  name: string | null;
  connected: boolean;
  graceDeadline: number | null;
  botControlled: boolean;
}

export type PublicGameConfig = Omit<GameConfig, 'seed'>;

export type PublicPlayerView = Omit<PlayerView, 'config'> & {
  config: PublicGameConfig;
};

export interface GameView {
  view: PublicPlayerView;
  seats: GameViewSeat[];
}

function stripSeed(config: GameConfig): PublicGameConfig {
  // `config.seed` deterministically drives shuffle + per-action RNG. Exposing it
  // to any connected client lets them reconstruct every opponent's hidden state.
  const { seed: _seed, ...rest } = config;
  return rest;
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
  const view: PublicPlayerView = { ...raw, config: stripSeed(raw.config) };
  return { view, seats: seats ?? buildSeats(room) };
}
