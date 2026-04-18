import type { Server } from 'node:http';
import type { LobbyStreamRegistry } from './sse/registry';
import type { GameRegistry } from './game/registry';
import type { RoomManager } from './room/manager';
import type { GameUpgradeHandler } from './game/handshake';
import { logger } from './logger';

export interface ShutdownOptions {
  httpServer: Server;
  registry?: LobbyStreamRegistry;
  gameRegistry?: GameRegistry;
  roomManager?: RoomManager;
  upgrade?: GameUpgradeHandler;
  drainMs?: number;
  // Tests inject a no-op to avoid terminating the vitest worker.
  onExit?: (code: number) => void;
}

export function installShutdown(opts: ShutdownOptions): (code: number) => Promise<void> {
  const onExit = opts.onExit ?? ((code: number) => process.exit(code));
  let inProgress = false;

  async function shutdown(code: number): Promise<void> {
    if (inProgress) return;
    inProgress = true;
    logger.info({ code }, 'shutdown starting');

    // Stop accepting new WS upgrades first, then tell connected clients to
    // close. `http.Server.close()` does not terminate sockets upgraded to
    // WebSocket (Node issue #53536), so if we awaited it before broadcasting
    // close frames the promise would never resolve under live traffic.
    if (opts.upgrade) {
      opts.upgrade.close();
    }

    if (opts.gameRegistry) {
      opts.gameRegistry.broadcastCloseAll(1001, 'shutdown');
    }

    if (opts.roomManager) {
      for (const room of opts.roomManager.allRooms()) {
        if (room.idleTimer) { clearTimeout(room.idleTimer); room.idleTimer = null; }
        if (room.cleanupTimer) { clearTimeout(room.cleanupTimer); room.cleanupTimer = null; }
        for (const slot of room.slots) {
          if (slot.kind === 'human' && slot.graceTimer) {
            clearTimeout(slot.graceTimer);
            slot.graceTimer = null;
            slot.graceDeadline = null;
          }
        }
      }
    }

    const drain = opts.drainMs ?? 5_000;
    await new Promise((r) => setTimeout(r, drain));

    await new Promise<void>((resolve) => opts.httpServer.close(() => resolve()));

    logger.info({ code }, 'shutdown complete');
    logger.flush();
    setImmediate(() => onExit(code));
  }

  process.on('SIGTERM', () => void shutdown(0));
  process.on('SIGINT', () => void shutdown(0));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    logger.flush();
    onExit(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'unhandled rejection');
    logger.flush();
    onExit(1);
  });

  return shutdown;
}
