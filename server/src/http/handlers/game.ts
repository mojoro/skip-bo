import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RoomManager } from '../../room/manager';
import { extractBearer } from '../middleware/auth';
import { writeProblem } from '../middleware/errorHandler';
import { problemFromError } from '../../problemJson';
import { unauthorized, notFound } from './_helpers';

export function postGame(mgr: RoomManager) {
  return (req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    const session = extractBearer(req);
    const instance = `/v1/rooms/${params.id}/game`;
    if (!session) return unauthorized(res, instance);
    const room = mgr.get(params.id!);
    if (!room) return notFound(res, instance);
    try {
      mgr.startGame(room.id, { actorSessionId: session });
      res.statusCode = 201;
      res.setHeader('location', instance);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ startedAt: Date.now() }));
    } catch (err) {
      writeProblem(res, problemFromError(err, instance));
    }
  };
}
