import type { Server } from 'node:http';
import type { LobbyStreamRegistry } from './sse/registry';
import { logger } from './logger';

export interface ShutdownOptions {
  httpServer: Server;
  registry?: LobbyStreamRegistry;
  drainMs?: number;
}

export function installShutdown(opts: ShutdownOptions): (code: number) => Promise<void> {
  let inProgress = false;

  async function shutdown(code: number): Promise<void> {
    if (inProgress) return;
    inProgress = true;
    logger.info({ code }, 'shutdown starting');

    await new Promise<void>((resolve) => opts.httpServer.close(() => resolve()));
    // Section 3 stub: broadcast 1001 to every game WS here once it exists.

    const drain = opts.drainMs ?? 5_000;
    await new Promise((r) => setTimeout(r, drain));

    logger.info({ code }, 'shutdown complete');
    process.exit(code);
  }

  process.on('SIGTERM', () => void shutdown(0));
  process.on('SIGINT', () => void shutdown(0));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception — exiting');
    void shutdown(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'unhandled rejection — exiting');
    void shutdown(1);
  });

  return shutdown;
}
