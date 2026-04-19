import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import type { RoomManager } from '../../room/manager';
import { projectRoomInfo } from '../../room/slots';
import { readJsonBody } from '../middleware/bodyParser';
import { extractBearer } from '../middleware/auth';
import { createRoomSchema, patchRoomSchema } from '../schemas';
import { unauthorized, forbidden, notFound, conflict, unprocessable } from './_helpers';

export function postRoom(mgr: RoomManager) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const session = extractBearer(req);
    if (!session) return unauthorized(res, '/v1/rooms');
    const raw = await readJsonBody(req);
    const parsed = createRoomSchema.safeParse(raw);
    if (!parsed.success) return unprocessable(res, '/v1/rooms', parsed.error);
    const { room } = mgr.create({
      sessionId: session,
      playerName: parsed.data.playerName,
      displayName: parsed.data.displayName,
      config: parsed.data.config,
      allowAiFill: parsed.data.allowAiFill,
      visibility: parsed.data.visibility,
    });
    res.statusCode = 201;
    res.setHeader('location', `/v1/rooms/${room.id}`);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      roomId: room.id,
      code: room.code,
      room: projectRoomInfo(room, { context: 'direct' }),
    }));
  };
}

export function listRooms(mgr: RoomManager) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const code = url.searchParams.get('code');
    const visibility = url.searchParams.get('visibility') ?? 'public';
    const phase = url.searchParams.get('phase') ?? 'waiting';
    let rooms = mgr.listPublicWaiting();
    if (visibility === 'public' && phase !== 'waiting') rooms = [];
    if (code) {
      const hit = mgr.findByCode(code);
      rooms = hit ? [hit] : [];
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      rooms: rooms.map((r) => projectRoomInfo(r, { context: code ? 'direct' : 'list' })),
      stats: mgr.stats(),
    }));
  };
}

// `GET /v1/me/room` — looks up the caller's current room via the bearer
// sessionId. Returns `{ roomId: string | null }`. The lobby uses this to
// show a "resume your game" affordance and gate create/join when the
// session is already seated somewhere. Unlike the room list, this route
// requires the bearer header (otherwise an unauthed caller would see
// `null` and could believe they're unseated when they're not).
export function getMyRoom(mgr: RoomManager) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const session = extractBearer(req);
    const instance = '/v1/me/room';
    if (!session) return unauthorized(res, instance);
    const roomId = mgr.sessionRoomId(session) ?? null;
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ roomId }));
  };
}

export function getRoom(mgr: RoomManager) {
  return (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>): void => {
    const room = mgr.get(params.id!);
    if (!room) return notFound(res, `/v1/rooms/${params.id}`);
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(projectRoomInfo(room, { context: 'direct' })));
  };
}

export function patchRoom(mgr: RoomManager) {
  return async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> => {
    const session = extractBearer(req);
    const instance = `/v1/rooms/${params.id}`;
    if (!session) return unauthorized(res, instance);
    const room = mgr.get(params.id!);
    if (!room) return notFound(res, instance);
    if (session !== room.hostSessionId) return forbidden(res, instance);
    if (room.phase !== 'waiting') return conflict(res, instance, 'phase', 'Room is not waiting');
    const raw = await readJsonBody(req);
    const parsed = patchRoomSchema.safeParse(raw);
    if (!parsed.success) return unprocessable(res, instance, parsed.error);
    if (parsed.data.displayName) room.displayName = parsed.data.displayName;
    if (parsed.data.visibility) room.visibility = parsed.data.visibility;
    if (parsed.data.allowAiFill !== undefined) room.allowAiFill = parsed.data.allowAiFill;
    if (parsed.data.config) Object.assign(room.config, parsed.data.config);
    mgr.markUpdated(room);
    res.statusCode = 204;
    res.end();
  };
}
