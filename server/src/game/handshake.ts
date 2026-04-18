import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { RoomManager } from '../room/manager';
import type { GameRegistry } from './registry';
import { GameConnection } from './connection';
import { MAX_MESSAGE_BYTES } from './protocol';
import { logger } from '../logger';
import { TokenBucketLimiter, LIMITS } from '../http/middleware/rateLimit';

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
  // Keyed on remote address — a session can legitimately reconnect (grace
  // resume, tab refocus), but a single IP shouldn't be hammering out dozens
  // of handshakes per second.
  const upgradeLimiter = new TokenBucketLimiter(LIMITS.gameUpgrade);
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
    // Abandon every early-exit path by removing the error listener we just
    // attached. Leaving it on a destroyed socket is benign (GC eventually
    // reaps) but it's an easy source of future leaks if the socket
    // lifecycle changes.
    const bail = (response?: string): void => {
      if (response) socket.write(response);
      socket.removeListener('error', onSocketError);
      socket.destroy();
    };
    if (shuttingDown) {
      bail('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      return;
    }
    // The HTTP server hands us the underlying net.Socket typed as Duplex —
    // narrow to read remoteAddress. Node guarantees the concrete type here.
    const remote = (socket as Socket).remoteAddress ?? 'unknown';
    if (!upgradeLimiter.take(remote)) {
      log.warn({ remote }, 'upgradeRateLimit');
      bail('HTTP/1.1 429 Too Many Requests\r\nRetry-After: 10\r\n\r\n');
      return;
    }
    try {
      // Fixed base — the client-supplied Host header has no bearing on what
      // we read (pathname + searchParams only), and pinning it keeps any
      // future reader from absorbing a spoofed Host into url.origin/.host.
      const url = new URL(req.url ?? '/', 'http://skip-bo.internal');
      const match = PATH_RE.exec(url.pathname);
      if (!match) { bail(); return; }
      const roomId = decodeURIComponent(match[1]!);

      const origin = req.headers.origin;
      if (deps.corsOrigin !== '*' && (!origin || origin !== deps.corsOrigin)) {
        bail('HTTP/1.1 403 Forbidden\r\n\r\n');
        return;
      }

      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) {
        bail('HTTP/1.1 400 Bad Request\r\n\r\n');
        return;
      }

      const room = deps.manager.get(roomId);
      const mappedRoomId = deps.manager.sessionRoomId(sessionId);
      const sessionMismatch = !room || mappedRoomId !== roomId;

      if (sessionMismatch) {
        wss.handleUpgrade(req, socket, head, (ws) => {
          socket.removeListener('error', onSocketError);
          ws.close(4003, 'invalid session');
        });
        return;
      }

      // Phase mismatch is timing, not identity — the host may have pressed
      // "Start" a moment ago, or the game may have just ended. Use 4006 so
      // the client's terminal-code set lets it retry after backoff instead
      // of freezing on a "Connection closed" screen.
      if (room.phase !== 'playing') {
        wss.handleUpgrade(req, socket, head, (ws) => {
          socket.removeListener('error', onSocketError);
          ws.close(4006, 'room not playing');
        });
        return;
      }

      const slotIndex = room.slots.findIndex((s) => s.kind === 'human' && s.sessionId === sessionId);
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
          ws, room, sessionId, slotIndex,
          manager: deps.manager, registry: deps.registry,
        });
      });
    } catch (err) {
      log.error({ err }, 'upgradeError');
      try { bail(); } catch { /* ignore */ }
    }
  };

  const close = (): void => {
    shuttingDown = true;
    wss.close();
  };

  return { handleUpgrade, close };
}
