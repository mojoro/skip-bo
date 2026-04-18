import type { PlayerView } from '@engine/engine';
import { getPlayerView } from '@engine/engine';
import type { Room, Slot } from '../types';

export interface GameViewSeat {
  slotIndex: number;
  kind: Slot['kind'];
  name: string | null;
  connected: boolean;
  graceDeadline: number | null;
  botControlled: boolean;
}

export interface GameView {
  view: PlayerView;
  seats: GameViewSeat[];
}

export function buildGameView(room: Room, sessionId: string): GameView {
  if (!room.game) throw new Error('buildGameView: room has no game');
  const view = getPlayerView(room.game, sessionId);
  const seats: GameViewSeat[] = room.slots.map((slot, slotIndex) => {
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
  return { view, seats };
}
