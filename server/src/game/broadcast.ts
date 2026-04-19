import type { Room } from '../types';
import type { GameRegistry } from './registry';
import type { ServerMessage } from './protocol';
import { buildGameView, buildSeats } from './view';

export function broadcastRoomState(room: Room, registry: GameRegistry): void {
  const seats = buildSeats(room);
  const stateVersion = room.game?.stateVersion ?? 0;
  registry.forEachInRoom(room.id, (conn) => {
    try {
      const view = buildGameView(room, conn.sessionId, seats);
      const msg: ServerMessage = { type: 'state', stateVersion, view };
      conn.send(msg);
    } catch (_err) {
      // Swallow per-connection errors; one bad socket must not break the fan-out.
    }
  });
}
