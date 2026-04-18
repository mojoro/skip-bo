import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { RoomManager } from '../room/manager';
import type { GameRegistry } from './registry';
import { GameConnection } from './connection';
import { MAX_MESSAGE_BYTES } from './protocol';
import { logger } from '../logger';

const PATH_RE = /^\/rooms\/([^/]+)\/game$/;

export interface HandshakeDeps {
  manager: RoomManager;
  registry: GameRegistry;
  corsOrigin: string;
}

export interface GameUpgradeHandler {
  handleUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
  close: () => void;
}

export function createGameUpgradeHandler(deps: HandshakeDeps): GameUpgradeHandler {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const log = logger.child({ component: 'gameWs.handshake' });
  let shuttingDown = false;

  const onSocketError = (err: Error): void => {
    log.warn({ err }, 'upgradeSocketError');
  };

  wss.on('wsClientError', (err, socket) => {
    log.warn({ err }, 'wsClientError');
    try { socket.destroy(); } catch { /* ignore */ }
  });

  const handleUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    socket.on('error', onSocketError);
    if (shuttingDown) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const match = PATH_RE.exec(url.pathname);
      if (!match) { socket.destroy(); return; }
      const roomId = decodeURIComponent(match[1]!);

      const origin = req.headers.origin;
      if (deps.corsOrigin !== '*' && (!origin || origin !== deps.corsOrigin)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      const room = deps.manager.get(roomId);
      const mappedRoomId = deps.manager.sessionRoomId(sessionId);
      const valid = room && mappedRoomId === roomId && room.phase === 'playing';

      if (!valid) {
        wss.handleUpgrade(req, socket, head, (ws) => {
          socket.removeListener('error', onSocketError);
          ws.close(4003, 'invalid session');
        });
        return;
      }

      const slotIndex = room!.slots.findIndex((s) => s.kind === 'human' && s.sessionId === sessionId);
      if (slotIndex < 0) {
        wss.handleUpgrade(req, socket, head, (ws) => {
          socket.removeListener('error', onSocketError);
          ws.close(4003, 'no slot');
        });
        return;
      }

      const existing = deps.registry.findBySession(roomId, sessionId);
      if (existing) {
        deps.registry.remove(roomId, existing);
        existing.close(4004, 'duplicate session');
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        socket.removeListener('error', onSocketError);
        new GameConnection({
          ws, room: room!, sessionId, slotIndex,
          manager: deps.manager, registry: deps.registry,
        });
      });
    } catch (err) {
      log.error({ err }, 'upgradeError');
      try { socket.destroy(); } catch { /* ignore */ }
    }
  };

  const close = (): void => {
    shuttingDown = true;
    wss.close();
  };

  return { handleUpgrade, close };
}
