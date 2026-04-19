import type { Room } from '../types';
import type { RoomManager } from '../room/manager';
import type { GameRegistry } from './registry';
import type { ServerMessage } from './protocol';
import { buildGameView, buildSeats } from './view';
import { maybeRunBotTurn } from './bot';
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

// Handles the side-effects that must follow any state change during play:
// fan out gameEnded + schedule cleanup on a finish, or kick off a bot turn
// when the current player is AI / bot-controlled. The bot callback
// recurses through here so a chain of consecutive bot turns keeps driving
// itself until a human becomes current or the game ends.
//
// Called from two entry points:
//  * `connection.ts:onAfterCommit` after a human action commits.
//  * `index.ts:onRoomStateChange` after REST mutations (including startGame,
//    which is the only way a fresh game lands with a bot as the first player).
// `room.botPending` guards against double-scheduling when both paths fire.
export function driveRoomAfterStateChange(
  room: Room,
  registry: GameRegistry,
  manager: RoomManager,
): void {
  if (room.phase !== 'playing' || !room.game) return;
  if (room.game.phase === 'finished') {
    const stateVersion = room.game.stateVersion;
    const seats = buildSeats(room);
    registry.forEachInRoom(room.id, (conn) => {
      try {
        const view = buildGameView(room, conn.sessionId, seats);
        const msg: ServerMessage = { type: 'gameEnded', stateVersion, view, reason: 'winner' };
        conn.send(msg);
      } catch (err) {
        log.warn({ err, roomId: room.id, sessionId: conn.sessionId }, 'buildGameView failed during gameEnded fan-out');
      }
    });
    manager.finishGame(room.id, 'winner');
    return;
  }
  maybeRunBotTurn(room, {
    onAfterMove: () => {
      broadcastRoomState(room, registry);
      driveRoomAfterStateChange(room, registry, manager);
    },
  });
}
