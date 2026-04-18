import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
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

describe('members', () => {
  let ctx: Awaited<ReturnType<typeof start>>;
  beforeEach(async () => { ctx = await start(); });
  afterEach(() => { ctx.server.close(); });

  it('joins a room, returns Location + wsUrl + slotIndex', async () => {
    const { room } = ctx.mgr.create({ sessionId: 'h', playerName: 'H', config: cfg(), allowAiFill: true, visibility: 'public' });
    const res = await fetch(`${ctx.url}/v1/rooms/${room.id}/members`, {
      method: 'POST',
      headers: { authorization: 'Bearer s2', 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: 'S2' }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('location')).toBe(`/v1/rooms/${room.id}/members/s2`);
    const body = (await res.json()) as { slotIndex: number; wsUrl: string };
    expect(body.slotIndex).toBe(1);
    expect(body.wsUrl).toMatch(new RegExp(`/game\\?roomId=${room.id}`));
  });

  it('returns 409 when full', async () => {
    const { room } = ctx.mgr.create({ sessionId: 'h', playerName: 'H', config: cfg(), allowAiFill: true, visibility: 'public' });
    for (const s of ['a', 'b', 'c']) ctx.mgr.addMember(room.id, { sessionId: s, playerName: s });
    const res = await fetch(`${ctx.url}/v1/rooms/${room.id}/members`, {
      method: 'POST',
      headers: { authorization: 'Bearer d', 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: 'D' }),
    });
    expect(res.status).toBe(409);
  });

  it('DELETE self-leaves', async () => {
    const { room } = ctx.mgr.create({ sessionId: 'h', playerName: 'H', config: cfg(), allowAiFill: true, visibility: 'public' });
    ctx.mgr.addMember(room.id, { sessionId: 's2', playerName: 'S2' });
    const res = await fetch(`${ctx.url}/v1/rooms/${room.id}/members/s2`, {
      method: 'DELETE',
      headers: { authorization: 'Bearer s2' },
    });
    expect(res.status).toBe(204);
    expect(room.slots[1]!.kind).toBe('open');
  });

  it('DELETE non-host non-self is forbidden', async () => {
    const { room } = ctx.mgr.create({ sessionId: 'h', playerName: 'H', config: cfg(), allowAiFill: true, visibility: 'public' });
    ctx.mgr.addMember(room.id, { sessionId: 's2', playerName: 'S2' });
    const res = await fetch(`${ctx.url}/v1/rooms/${room.id}/members/s2`, {
      method: 'DELETE',
      headers: { authorization: 'Bearer attacker' },
    });
    expect(res.status).toBe(403);
  });
});
