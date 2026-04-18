import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { logger } from '../logger';
import { assignFlowId } from './middleware/flowId';
import { applyCors } from './middleware/cors';
import { handleUnknown, writeProblem } from './middleware/errorHandler';
import { problemResponse } from '../problemJson';
import { Router } from './router';
import type { RoomManager } from '../room/manager';
import { postRoom, listRooms, getRoom, patchRoom } from './handlers/rooms';
import { postMember, deleteMember } from './handlers/members';
import { putSlot } from './handlers/slots';
import { postGame } from './handlers/game';
import { getLobbyStream } from './handlers/lobbyStream';
import type { LobbyStreamRegistry } from '../sse/registry';
import { TokenBucketLimiter, LIMITS } from './middleware/rateLimit';
import { extractBearer } from './middleware/auth';

const limiters = {
  createRoom: new TokenBucketLimiter(LIMITS.createRoom),
  join: new TokenBucketLimiter(LIMITS.join),
  admin: new TokenBucketLimiter(LIMITS.admin),
};

function limiterFor(method: string, path: string): TokenBucketLimiter | null {
  if (method === 'POST' && path === '/v1/rooms') return limiters.createRoom;
  if (method === 'POST' && /^\/v1\/rooms\/[^/]+\/members$/.test(path)) return limiters.join;
  if (method === 'DELETE' && /^\/v1\/rooms\/[^/]+\/members\/[^/]+$/.test(path)) return limiters.admin;
  if (method === 'PUT' && /^\/v1\/rooms\/[^/]+\/slots\/[^/]+$/.test(path)) return limiters.admin;
  if (method === 'PATCH' && /^\/v1\/rooms\/[^/]+$/.test(path)) return limiters.admin;
  return null;
}

export interface BuildOptions {
  roomManager: RoomManager;
  corsOrigin: string;
}

export interface BuiltServer {
  httpServer: Server;
  router: Router;
}

export function buildHttpServer(opts: BuildOptions): BuiltServer {
  const router = new Router();
  const httpServer = createServer((req, res) => {
    void handle(req, res);
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const flowId = assignFlowId(req, res);
    const { isPreflight } = applyCors(req, res, opts.corsOrigin);
    if (isPreflight) return;
    const url = new URL(req.url ?? '/', 'http://localhost');
    const instance = url.pathname;
    try {
      const limiter = limiterFor(req.method ?? 'GET', url.pathname);
      if (limiter) {
        const key = `${extractBearer(req) ?? 'anon'}::${req.socket.remoteAddress}`;
        if (!limiter.take(key)) {
          res.setHeader('retry-after', '10');
          return writeProblem(res, problemResponse({
            type: 'https://skip-bo.example.com/problems/rate-limited',
            title: 'Too Many Requests', status: 429, instance: url.pathname,
          }));
        }
      }
      const match = router.match(req.method ?? 'GET', url.pathname);
      if (!match) {
        writeProblem(res, problemResponse({
          type: 'https://skip-bo.example.com/problems/not-found',
          title: 'Not Found',
          status: 404,
          instance,
        }));
        return;
      }
      await match.handler(req, res, match.params);
    } catch (err) {
      logger.error({ err, flowId, path: url.pathname, method: req.method }, 'unhandled request error');
      handleUnknown(res, err, instance);
    }
  }

  return { httpServer, router };
}

export function mountRoutes(
  router: Router,
  mgr: RoomManager,
  extras: { registry?: LobbyStreamRegistry } = {},
): void {
  router.add('GET', '/v1/rooms', listRooms(mgr));
  router.add('POST', '/v1/rooms', postRoom(mgr));
  router.add('GET', '/v1/rooms/:id', getRoom(mgr));
  router.add('PATCH', '/v1/rooms/:id', patchRoom(mgr));
  router.add('POST', '/v1/rooms/:id/members', postMember(mgr));
  router.add('DELETE', '/v1/rooms/:id/members/:sessionId', deleteMember(mgr));
  router.add('PUT', '/v1/rooms/:id/slots/:index', putSlot(mgr));
  router.add('POST', '/v1/rooms/:id/game', postGame(mgr));
  if (extras.registry) {
    router.add('GET', '/v1/lobby/stream', getLobbyStream(mgr, extras.registry));
  }
}
