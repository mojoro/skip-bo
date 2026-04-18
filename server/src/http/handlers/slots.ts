import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RoomManager } from '../../room/manager';
import { readJsonBody } from '../middleware/bodyParser';
import { extractBearer } from '../middleware/auth';
import { writeProblem } from '../middleware/errorHandler';
import { problemResponse, problemFromError } from '../../problemJson';
import { setSlotSchema } from '../schemas';
import { unauthorized, notFound, unprocessable } from './_helpers';

export function putSlot(mgr: RoomManager) {
  return async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> => {
    const session = extractBearer(req);
    const instance = `/v1/rooms/${params.id}/slots/${params.index}`;
    if (!session) return unauthorized(res, instance);
    const room = mgr.get(params.id!);
    if (!room) return notFound(res, instance);
    const raw = await readJsonBody(req);
    const parsed = setSlotSchema.safeParse(raw);
    if (!parsed.success) return unprocessable(res, instance, parsed.error);
    const index = Number(params.index);
    if (!Number.isInteger(index)) {
      return writeProblem(res, problemResponse({
        type: 'https://skip-bo.example.com/problems/badIndex',
        title: 'Bad Index', status: 422, instance,
      }));
    }
    try {
      mgr.setSlot(room.id, index, parsed.data, { actorSessionId: session });
      res.statusCode = 204;
      res.end();
    } catch (err) {
      writeProblem(res, problemFromError(err, instance));
    }
  };
}
