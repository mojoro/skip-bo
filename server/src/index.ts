import { config } from './config';
import { logger } from './logger';
import { RoomManager } from './room/manager';
import { LobbyStreamRegistry } from './sse/registry';
import { buildHttpServer, mountRoutes } from './http/server';
import { startStatsTicker } from './stats';
import { installShutdown } from './shutdown';

function main(): void {
  const roomManager = new RoomManager();
  const registry = new LobbyStreamRegistry();

  roomManager.events.on('roomAdded', (e) => registry.publish(e));
  roomManager.events.on('roomUpdated', (e) => registry.publish(e));
  roomManager.events.on('roomRemoved', (e) => registry.publish(e));

  const { httpServer, router } = buildHttpServer({
    roomManager,
    corsOrigin: config.corsOrigin,
  });
  mountRoutes(router, roomManager, { registry });
  const stopStats = startStatsTicker(roomManager, registry);

  installShutdown({ httpServer, registry });

  httpServer.listen(config.httpPort, () => {
    logger.info({ port: config.httpPort }, 'server listening');
  });

  process.on('exit', () => stopStats());
}

main();
