import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { logger } from '../logger';
import { assignFlowId } from './middleware/flowId';
import { applyCors } from './middleware/cors';
import { handleUnknown, writeProblem } from './middleware/errorHandler';
import { problemResponse } from '../problemJson';
import { Router } from './router';
import type { RoomManager } from '../room/manager';

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
