import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { buildHttpServer, mountRoutes } from '../../src/http/server';
import { RoomManager } from '../../src/room/manager';
import { LobbyStreamRegistry } from '../../src/sse/registry';
import { GameRegistry } from '../../src/game/registry';
import { createGameUpgradeHandler } from '../../src/game/handshake';

async function startHarness() {
  const mgr = new RoomManager();
  const registry = new LobbyStreamRegistry();
  const gameRegistry = new GameRegistry();
  const { httpServer, router } = buildHttpServer({ roomManager: mgr, corsOrigin: '*' });
  mountRoutes(router, mgr, { registry });
  httpServer.on('upgrade', createGameUpgradeHandler({ manager: mgr, registry: gameRegistry, corsOrigin: '*' }).handleUpgrade);
  await new Promise<void>((r) => httpServer.listen(0, r));
  const { port } = httpServer.address() as AddressInfo;
  return {
    mgr, registry, gameRegistry,
    base: `http://127.0.0.1:${port}`, wsBase: `ws://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => httpServer.close(() => r())),
  };
}

async function startRoom(h: Awaited<ReturnType<typeof startHarness>>) {
  const create = await fetch(`${h.base}/v1/rooms`, {
    method: 'POST',
    headers: { authorization: 'Bearer host', 'content-type': 'application/json' },
    body: JSON.stringify({ playerName: 'Host', config: { ruleset: 'recommended', stockPileSize: 10, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null }, allowAiFill: false, visibility: 'public' }),
  });
  const { roomId } = (await create.json()) as { roomId: string };
  await fetch(`${h.base}/v1/rooms/${roomId}/members`, {
    method: 'POST',
    headers: { authorization: 'Bearer guest', 'content-type': 'application/json' },
    body: JSON.stringify({ playerName: 'Guest' }),
  });
  await fetch(`${h.base}/v1/rooms/${roomId}/game`, { method: 'POST', headers: { authorization: 'Bearer host' } });
  return roomId;
}

function open(wsBase: string, roomId: string, sessionId: string): Promise<{ ws: WebSocket; hello: any }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}/rooms/${roomId}/game?sessionId=${sessionId}`);
    const t = setTimeout(() => reject(new Error('hello timeout')), 3000);
    ws.once('message', (raw) => {
      clearTimeout(t);
      resolve({ ws, hello: JSON.parse(raw.toString('utf-8')) });
    });
    ws.once('error', reject);
  });
}

function nextJson(ws: WebSocket, pred: (m: any) => boolean, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('match timeout')), timeoutMs);
    function onMsg(raw: Buffer) {
      const msg = JSON.parse(raw.toString('utf-8'));
      if (pred(msg)) { clearTimeout(t); ws.off('message', onMsg); resolve(msg); }
    }
    ws.on('message', onMsg);
  });
}

describe('game ws full flow', () => {
  let h: Awaited<ReturnType<typeof startHarness>>;
  afterEach(async () => { if (h) await h.close(); });

  it('two clients exchange chat and see presence changes after disconnect', async () => {
    h = await startHarness();
    const roomId = await startRoom(h);
    const host = await open(h.wsBase, roomId, 'host');
    const guest = await open(h.wsBase, roomId, 'guest');
    expect(host.hello.type).toBe('hello');
    expect(guest.hello.type).toBe('hello');

    // Host sends chat; guest receives it.
    host.ws.send(JSON.stringify({ type: 'chat', text: 'hello' }));
    const chatRecv = await nextJson(guest.ws, (m) => m.type === 'chat');
    expect(chatRecv.text).toBe('hello');

    // Host disconnects; guest sees host seat with graceDeadline set.
    host.ws.close();
    const presenceMsg = await nextJson(guest.ws, (m) =>
      m.type === 'state' && m.view.seats.some((s: any) => s.name === 'Host' && s.connected === false && s.graceDeadline !== null),
    );
    expect(presenceMsg).toBeTruthy();

    // Host reconnects before grace expires; guest sees connected flip.
    const hostReconnect = await open(h.wsBase, roomId, 'host');
    expect(hostReconnect.hello.type).toBe('hello');
    const backOnline = await nextJson(guest.ws, (m) =>
      m.type === 'state' && m.view.seats.some((s: any) => s.name === 'Host' && s.connected === true && s.graceDeadline === null),
    );
    expect(backOnline).toBeTruthy();

    hostReconnect.ws.close();
    guest.ws.close();
  });
});
