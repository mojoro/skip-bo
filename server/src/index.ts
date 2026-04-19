import { config } from './config';
import { logger } from './logger';
import { RoomManager } from './room/manager';
import { LobbyStreamRegistry } from './sse/registry';
import { buildHttpServer, mountRoutes } from './http/server';
import { startStatsTicker } from './stats';
import { installShutdown } from './shutdown';
import { GameRegistry } from './game/registry';
import { createGameUpgradeHandler } from './game/handshake';
import { broadcastRoomState, driveRoomAfterStateChange } from './game/broadcast';

function main(): void {
  if (process.env.NODE_ENV === 'production' && config.corsOrigin === '*') {
    logger.fatal('CORS_ORIGIN must be set in production to prevent CSWSH');
    process.exit(1);
  }

  const roomManager = new RoomManager();
  const registry = new LobbyStreamRegistry();
  const gameRegistry = new GameRegistry();

  roomManager.events.on('roomAdded', (e) => registry.publish(e));
  roomManager.events.on('roomUpdated', (e) => registry.publish(e));
  roomManager.events.on('roomRemoved', (e) => registry.publish(e));
  // Close game sockets for every room that closes, including private rooms
  // that the lobby event channel skips on purpose. The subscriber is
  // deliberately on the internal bus so it fires regardless of visibility.
  roomManager.onRoomClosed((roomId) => {
    gameRegistry.forEachInRoom(roomId, (conn) => conn.close(4005, 'room closed'));
  });
  // Host-driven displacement (setSlot human→open/ai/locked). Belt-and-
  // suspenders: the handshake rejects pre-playing connections so there is
  // nothing to close today, but if a future product change opens WS during
  // waiting this keeps the kicked session from lingering on its socket.
  roomManager.onMemberDisplaced((roomId, sessionId) => {
    const conn = gameRegistry.findBySession(roomId, sessionId);
    if (conn) conn.close(4002, 'kicked');
  });
  // Fan-out room state to every attached game-WS socket when a REST mutation
  // changes the room (join/leave, slot config, game start, config patch).
  // After startGame the phase is 'playing' and buildGameView returns a full
  // PlayerView, so the same event drives pre-game sockets into the Board.
  roomManager.onRoomStateChange((roomId) => {
    const room = roomManager.get(roomId);
    if (!room) return;
    broadcastRoomState(room, gameRegistry);
    // Fire the bot chain + win-detection after broadcasting. Critical when
    // startGame lands with an AI seat as the first player — nothing else
    // would trigger maybeRunBotTurn until a human moved, so the game would
    // hang indefinitely.
    driveRoomAfterStateChange(room, gameRegistry, roomManager);
  });

  const { httpServer, router } = buildHttpServer({
    roomManager,
    corsOrigin: config.corsOrigin,
  });

  mountRoutes(router, roomManager, { registry });
  const stopStats = startStatsTicker(roomManager, registry);

  const upgrade = createGameUpgradeHandler({
    manager: roomManager, registry: gameRegistry, corsOrigin: config.corsOrigin,
  });
  httpServer.on('upgrade', upgrade.handleUpgrade);

  installShutdown({ httpServer, registry, gameRegistry, roomManager, upgrade });

  httpServer.listen(config.httpPort, () => {
    logger.info({ port: config.httpPort }, 'server listening');
  });

  process.on('exit', () => stopStats());
}

main();
