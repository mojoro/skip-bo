import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { buildHttpServer, mountRoutes } from '../../src/http/server';
import { RoomManager } from '../../src/room/manager';

function cfg() { return { ruleset: 'recommended' as const, stockPileSize: 20, handSize: 5, bidirectionalBuild: true, maxPlayers: 4, partnership: null }; }

async function start() {
  const mgr = new RoomManager();
  const { httpServer, router } = buildHttpServer({ roomManager: mgr, corsOrigin: '*' });
  mountRoutes(router, mgr);
  await new Promise<void>((r) => httpServer.listen(0, r));
  const { port } = httpServer.address() as AddressInfo;
  return { server: httpServer, url: `http://127.0.0.1:${port}`, mgr };
}

describe('POST /v1/rooms/:id/game', () => {
  let ctx: Awaited<ReturnType<typeof start>>;
  beforeEach(async () => { ctx = await start(); });
  afterEach(() => { ctx.server.close(); });

  it('host starts the game when conditions are met', async () => {
    const { room } = ctx.mgr.create({ sessionId: 'h', playerName: 'H', config: cfg(), allowAiFill: true, visibility: 'public' });
    ctx.mgr.addMember(room.id, { sessionId: 'a', playerName: 'A' });
    const res = await fetch(`${ctx.url}/v1/rooms/${room.id}/game`, {
      method: 'POST',
      headers: { authorization: 'Bearer h' },
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('location')).toBe(`/v1/rooms/${room.id}/game`);
    expect(room.phase).toBe('playing');
  });

  it('non-host gets 403', async () => {
    const { room } = ctx.mgr.create({ sessionId: 'h', playerName: 'H', config: cfg(), allowAiFill: true, visibility: 'public' });
    ctx.mgr.addMember(room.id, { sessionId: 'a', playerName: 'A' });
    const res = await fetch(`${ctx.url}/v1/rooms/${room.id}/game`, { method: 'POST', headers: { authorization: 'Bearer a' } });
    expect(res.status).toBe(403);
  });
});
