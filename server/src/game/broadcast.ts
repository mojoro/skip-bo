import type { Room } from '../types';
import type { GameRegistry } from './registry';
import type { ServerMessage } from './protocol';
import { buildGameView, buildSeats } from './view';
import { logger } from '../logger';

const log = logger.child({ component: 'gameWs.broadcast' });

export function broadcastRoomState(room: Room, registry: GameRegistry): void {
  const seats = buildSeats(room);
  const stateVersion = room.game?.stateVersion ?? 0;
  registry.forEachInRoom(room.id, (conn) => {
    try {
      const view = buildGameView(room, conn.sessionId, seats);
      const msg: ServerMessage = { type: 'state', stateVersion, view };
      conn.send(msg);
    } catch (err) {
      // One bad socket must not break the fan-out. Keep going; surface the
      // failure through the logger so it's not silently dropped.
      log.warn({ err, roomId: room.id, sessionId: conn.sessionId }, 'buildGameView failed during broadcast');
    }
  });
}
