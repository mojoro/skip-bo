import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RoomManager } from '../../room/manager';
import { readJsonBody } from '../middleware/bodyParser';
import { extractBearer } from '../middleware/auth';
import { writeProblem } from '../middleware/errorHandler';
import { problemFromError } from '../../problemJson';
import { joinRoomSchema } from '../schemas';
import { projectRoomInfo } from '../../room/slots';
import { config } from '../../config';
import { unauthorized, notFound, unprocessable } from './_helpers';

export function postMember(mgr: RoomManager) {
  return async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> => {
    const session = extractBearer(req);
    const instance = `/v1/rooms/${params.id}/members`;
    if (!session) return unauthorized(res, instance);
    const room = mgr.get(params.id!);
    if (!room) return notFound(res, instance);
    const raw = await readJsonBody(req);
    const parsed = joinRoomSchema.safeParse(raw);
    if (!parsed.success) return unprocessable(res, instance, parsed.error);
    try {
      const { slotIndex } = mgr.addMember(room.id, {
        sessionId: session,
        playerName: parsed.data.playerName,
      });
      res.statusCode = 201;
      res.setHeader('location', `${instance}/${session}`);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        room: projectRoomInfo(room, { context: 'direct' }),
        slotIndex,
        wsUrl: `${config.wsBaseUrl}/game?roomId=${room.id}`,
      }));
    } catch (err) {
      writeProblem(res, problemFromError(err, instance));
    }
  };
}

export function deleteMember(mgr: RoomManager) {
  return (req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    const session = extractBearer(req);
    const instance = `/v1/rooms/${params.id}/members/${params.sessionId}`;
    if (!session) return unauthorized(res, instance);
    const room = mgr.get(params.id!);
    if (!room) return notFound(res, instance);
    try {
      mgr.removeMember(room.id, params.sessionId!, { actorSessionId: session });
      res.statusCode = 204;
      res.end();
    } catch (err) {
      writeProblem(res, problemFromError(err, instance));
    }
  };
}
