import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RingBuffer } from '../../src/sse/ringBuffer';
import { buildHttpServer, mountRoutes } from '../../src/http/server';
import { RoomManager } from '../../src/room/manager';
import { LobbyStreamRegistry } from '../../src/sse/registry';
import type { AddressInfo } from 'node:net';

describe('RingBuffer', () => {
  it('since(id) returns events after the given id', () => {
    const rb = new RingBuffer<string>(5);
    rb.push('a'); rb.push('b'); rb.push('c');
    expect(rb.since(1)).toEqual([{ id: 2, value: 'b' }, { id: 3, value: 'c' }]);
  });

  it('since(id) returns null when id is older than the ring', () => {
    const rb = new RingBuffer<string>(2);
    rb.push('a'); rb.push('b'); rb.push('c');
    expect(rb.since(1)).toBe(null);
  });

  it('since with empty buffer returns []', () => {
    const rb = new RingBuffer<string>(3);
    expect(rb.since(0)).toEqual([]);
  });
});

async function startSse() {
  const mgr = new RoomManager();
  const registry = new LobbyStreamRegistry();
  const { httpServer, router } = buildHttpServer({ roomManager: mgr, corsOrigin: '*' });
  mountRoutes(router, mgr, { registry });
  mgr.events.on('roomAdded', (e) => registry.publish(e));
  mgr.events.on('roomUpdated', (e) => registry.publish(e));
  mgr.events.on('roomRemoved', (e) => registry.publish(e));
  await new Promise<void>((r) => httpServer.listen(0, r));
  const { port } = httpServer.address() as AddressInfo;
  return { server: httpServer, url: `http://127.0.0.1:${port}`, mgr, registry };
}

describe('GET /v1/lobby/stream', () => {
  let ctx: Awaited<ReturnType<typeof startSse>>;
  beforeEach(async () => { ctx = await startSse(); });
  afterEach(() => { ctx.server.close(); });

  it('emits a snapshot then deltas', async () => {
    const res = await fetch(`${ctx.url}/v1/lobby/stream?sessionId=viewer-1`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const first = await reader.read();
    expect(decoder.decode(first.value!)).toMatch(/event: snapshot/);

    ctx.mgr.create({ sessionId: 'h', playerName: 'H',
      config: { ruleset: 'recommended', stockPileSize: 20, handSize: 5, bidirectionalBuild: true, maxPlayers: 4, partnership: null },
      allowAiFill: true, visibility: 'public' });

    const second = await reader.read();
    expect(decoder.decode(second.value!)).toMatch(/event: roomAdded/);
    reader.cancel();
  });
});
