import { describe, it, expect } from 'vitest';
import type { AddressInfo } from 'node:net';
import { buildHttpServer, mountRoutes } from '../../src/http/server';
import { RoomManager } from '../../src/room/manager';
import { LobbyStreamRegistry } from '../../src/sse/registry';

function baseConfig() {
  return { ruleset: 'recommended' as const, stockPileSize: 20, handSize: 5, bidirectionalBuild: true, maxPlayers: 4, partnership: null };
}

describe('integration: full lobby flow', () => {
  it('creates a room, joins, starts, and removes it from the lobby feed', async () => {
    const mgr = new RoomManager();
    const registry = new LobbyStreamRegistry();
    mgr.events.on('roomAdded', (e) => registry.publish(e));
    mgr.events.on('roomUpdated', (e) => registry.publish(e));
    mgr.events.on('roomRemoved', (e) => registry.publish(e));
    const { httpServer, router } = buildHttpServer({ roomManager: mgr, corsOrigin: '*' });
    mountRoutes(router, mgr, { registry });
    await new Promise<void>((r) => httpServer.listen(0, r));
    const { port } = httpServer.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    const sseRes = await fetch(`${base}/v1/lobby/stream?sessionId=viewer`);
    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();
    const firstChunk = decoder.decode((await reader.read()).value!);
    expect(firstChunk).toMatch(/event: snapshot/);

    const createRes = await fetch(`${base}/v1/rooms`, {
      method: 'POST',
      headers: { authorization: 'Bearer host', 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: 'Host', config: baseConfig(), allowAiFill: true, visibility: 'public' }),
    });
    expect(createRes.status).toBe(201);
    const { roomId } = (await createRes.json()) as { roomId: string };

    const next = decoder.decode((await reader.read()).value!);
    expect(next).toMatch(/event: roomAdded/);

    const joinRes = await fetch(`${base}/v1/rooms/${roomId}/members`, {
      method: 'POST',
      headers: { authorization: 'Bearer p2', 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: 'P2' }),
    });
    expect(joinRes.status).toBe(201);

    const startRes = await fetch(`${base}/v1/rooms/${roomId}/game`, {
      method: 'POST',
      headers: { authorization: 'Bearer host' },
    });
    expect(startRes.status).toBe(201);

    let sawRemoved = false;
    for (let i = 0; i < 3; i++) {
      const c = decoder.decode((await reader.read()).value!);
      if (c.includes('event: roomRemoved')) sawRemoved = true;
      if (sawRemoved) break;
    }
    expect(sawRemoved).toBe(true);

    reader.cancel();
    httpServer.close();
  });
});
