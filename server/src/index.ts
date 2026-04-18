import { config } from './config';
import { logger } from './logger';
import { RoomManager } from './room/manager';
import { LobbyStreamRegistry } from './sse/registry';
import { buildHttpServer, mountRoutes } from './http/server';
import { startStatsTicker } from './stats';
import { installShutdown } from './shutdown';
import { GameRegistry } from './game/registry';
import { createGameUpgradeHandler } from './game/handshake';

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
  roomManager.events.on('roomRemoved', (e) => {
    registry.publish(e);
    gameRegistry.forEachInRoom(e.roomId, (conn) => conn.close(4005, 'room closed'));
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
  httpServer.on('upgrade', upgrade);

  installShutdown({ httpServer, registry, gameRegistry, roomManager });

  httpServer.listen(config.httpPort, () => {
    logger.info({ port: config.httpPort }, 'server listening');
  });

  process.on('exit', () => stopStats());
}

main();
