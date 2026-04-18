import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { openSseStream, type SseWriter } from '../../sse/stream';
import type { LobbyStreamRegistry } from '../../sse/registry';
import type { RoomManager } from '../../room/manager';
import { projectRoomInfo } from '../../room/slots';

const HEARTBEAT_MS = 20_000;

export function getLobbyStream(mgr: RoomManager, registry: LobbyStreamRegistry) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const sessionId = url.searchParams.get('sessionId') ?? `anon-${Math.random().toString(36).slice(2)}`;
    const lastEventId = req.headers['last-event-id'];
    const lastId = typeof lastEventId === 'string' ? Number(lastEventId) : NaN;
    const writer = openSseStream(res);

    registry.subscribe(sessionId, writer);

    if (Number.isFinite(lastId)) {
      const result = registry.replaySince(writer, lastId);
      if (result === 'needSnapshot') sendSnapshot(writer, mgr);
    } else {
      sendSnapshot(writer, mgr);
    }

    const hb = setInterval(() => writer.sendComment('ping'), HEARTBEAT_MS);
    writer.onClose(() => clearInterval(hb));
  };
}

function sendSnapshot(writer: SseWriter, mgr: RoomManager): void {
  writer.sendEvent('snapshot', {
    type: 'snapshot',
    rooms: mgr.listPublicWaiting().map((r) => projectRoomInfo(r, { context: 'list' })),
    stats: mgr.stats(),
  });
}
