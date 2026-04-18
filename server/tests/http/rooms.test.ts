import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildHttpServer, mountRoutes } from '../../src/http/server';
import { RoomManager } from '../../src/room/manager';

function baseConfigBody() {
  return {
    ruleset: 'recommended' as const,
    stockPileSize: 20,
    handSize: 5,
    bidirectionalBuild: true,
    maxPlayers: 4,
    partnership: null,
  };
}

async function start(): Promise<{ server: Server; url: string; mgr: RoomManager }> {
  const mgr = new RoomManager();
  const { httpServer, router } = buildHttpServer({ roomManager: mgr, corsOrigin: '*' });
  mountRoutes(router, mgr);
  await new Promise<void>((r) => httpServer.listen(0, r));
  const { port } = httpServer.address() as AddressInfo;
  return { server: httpServer, url: `http://127.0.0.1:${port}`, mgr };
}

describe('POST /v1/rooms', () => {
  let ctx: Awaited<ReturnType<typeof start>>;
  beforeEach(async () => { ctx = await start(); });
  afterEach(() => { ctx.server.close(); });

  it('creates a room and returns 201 + Location', async () => {
    const res = await fetch(`${ctx.url}/v1/rooms`, {
      method: 'POST',
      headers: { authorization: 'Bearer s1', 'content-type': 'application/json' },
      body: JSON.stringify({
        playerName: 'John', config: baseConfigBody(),
        allowAiFill: true, visibility: 'public',
      }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('location')).toMatch(/\/v1\/rooms\/[0-9a-f-]+/);
    const body = (await res.json()) as { code: string; room: { displayName: string } };
    expect(body.room.displayName).toBe("John's table");
    expect(body.code).toMatch(/^[A-Z2-9]{6}$/);
  });

  it('returns 422 for malformed playerName', async () => {
    const res = await fetch(`${ctx.url}/v1/rooms`, {
      method: 'POST',
      headers: { authorization: 'Bearer s1', 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: '', config: baseConfigBody(), allowAiFill: true, visibility: 'public' }),
    });
    expect(res.status).toBe(422);
  });

  it('returns 401 when Authorization header missing', async () => {
    const res = await fetch(`${ctx.url}/v1/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: 'John', config: baseConfigBody(), allowAiFill: true, visibility: 'public' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 429 after exhausting create-room burst', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${ctx.url}/v1/rooms`, {
        method: 'POST',
        headers: { authorization: 'Bearer burst', 'content-type': 'application/json' },
        body: JSON.stringify({ playerName: `P${i}`, config: baseConfigBody(), allowAiFill: true, visibility: 'public' }),
      });
      expect([201, 409]).toContain(res.status);
    }
    const res = await fetch(`${ctx.url}/v1/rooms`, {
      method: 'POST',
      headers: { authorization: 'Bearer burst', 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: 'PX', config: baseConfigBody(), allowAiFill: true, visibility: 'public' }),
    });
    expect(res.status).toBe(429);
  });
});

describe('GET /v1/rooms', () => {
  let ctx: Awaited<ReturnType<typeof start>>;
  beforeEach(async () => { ctx = await start(); });
  afterEach(() => { ctx.server.close(); });

  it('returns rooms + stats', async () => {
    ctx.mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfigBody(), allowAiFill: true, visibility: 'public' });
    const res = await fetch(`${ctx.url}/v1/rooms`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rooms: unknown[]; stats: unknown };
    expect(body.rooms).toHaveLength(1);
    expect(body.stats).toEqual({ gamesInProgress: 0, playersOnline: 0 });
  });

  it('filters by code', async () => {
    const { room } = ctx.mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfigBody(), allowAiFill: true, visibility: 'private' });
    const res = await fetch(`${ctx.url}/v1/rooms?code=${room.code.toLowerCase()}`);
    const body = (await res.json()) as { rooms: { code: string }[] };
    expect(body.rooms).toHaveLength(1);
    expect(body.rooms[0]!.code).toBe(room.code);
  });
});

describe('PATCH /v1/rooms/:id', () => {
  let ctx: Awaited<ReturnType<typeof start>>;
  beforeEach(async () => { ctx = await start(); });
  afterEach(() => { ctx.server.close(); });

  it('updates displayName when caller is host', async () => {
    const { room } = ctx.mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfigBody(), allowAiFill: true, visibility: 'public' });
    const res = await fetch(`${ctx.url}/v1/rooms/${room.id}`, {
      method: 'PATCH',
      headers: { authorization: 'Bearer h', 'content-type': 'application/merge-patch+json' },
      body: JSON.stringify({ displayName: 'New Name' }),
    });
    expect(res.status).toBe(204);
    expect(room.displayName).toBe('New Name');
  });

  it('rejects non-host with 403', async () => {
    const { room } = ctx.mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfigBody(), allowAiFill: true, visibility: 'public' });
    const res = await fetch(`${ctx.url}/v1/rooms/${room.id}`, {
      method: 'PATCH',
      headers: { authorization: 'Bearer nope', 'content-type': 'application/merge-patch+json' },
      body: JSON.stringify({ displayName: 'Pwn' }),
    });
    expect(res.status).toBe(403);
  });
});
