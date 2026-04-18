import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { createConnection } from 'node:net';
import type { AddressInfo } from 'node:net';
import { buildHttpServer, mountRoutes } from '../../src/http/server';
import { RoomManager } from '../../src/room/manager';
import { LobbyStreamRegistry } from '../../src/sse/registry';
import { GameRegistry } from '../../src/game/registry';
import { createGameUpgradeHandler } from '../../src/game/handshake';

interface Harness {
  mgr: RoomManager; registry: LobbyStreamRegistry; gameRegistry: GameRegistry;
  base: string; port: number; wsBase: string;
  close: () => Promise<void>;
}

async function startHarness(corsOrigin = '*'): Promise<Harness> {
  const mgr = new RoomManager();
  const registry = new LobbyStreamRegistry();
  const gameRegistry = new GameRegistry();
  const { httpServer, router } = buildHttpServer({ roomManager: mgr, corsOrigin });
  mountRoutes(router, mgr, { registry });
  httpServer.on('upgrade', createGameUpgradeHandler({ manager: mgr, registry: gameRegistry, corsOrigin }).handleUpgrade);
  await new Promise<void>((r) => httpServer.listen(0, r));
  const { port } = httpServer.address() as AddressInfo;
  return {
    mgr, registry, gameRegistry,
    base: `http://127.0.0.1:${port}`, port, wsBase: `ws://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => httpServer.close(() => r())),
  };
}

async function startGameAndGetRoomId(h: Harness, bearers: { host: string; guest: string } = { host: 'host', guest: 'guest' }): Promise<{ roomId: string; host: string; guest: string }> {
  const create = await fetch(`${h.base}/v1/rooms`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearers.host}`, 'content-type': 'application/json' },
    body: JSON.stringify({ playerName: 'Host', config: { ruleset: 'recommended', stockPileSize: 10, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null }, allowAiFill: false, visibility: 'public' }),
  });
  const { roomId } = (await create.json()) as { roomId: string };
  await fetch(`${h.base}/v1/rooms/${roomId}/members`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearers.guest}`, 'content-type': 'application/json' },
    body: JSON.stringify({ playerName: 'Guest' }),
  });
  await fetch(`${h.base}/v1/rooms/${roomId}/game`, { method: 'POST', headers: { authorization: `Bearer ${bearers.host}` } });
  return { roomId, host: bearers.host, guest: bearers.guest };
}

async function waitForMessage(ws: WebSocket, timeoutMs = 2000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    ws.once('message', (raw) => { clearTimeout(t); resolve(JSON.parse(raw.toString('utf-8'))); });
    ws.once('error', reject);
  });
}

async function waitForClose(ws: WebSocket, timeoutMs = 2000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('close-timeout')), timeoutMs);
    ws.once('close', (code, reason) => { clearTimeout(t); resolve({ code, reason: reason.toString() }); });
  });
}

describe('game ws handshake', () => {
  let h: Harness;
  afterEach(async () => { if (h) await h.close(); });

  it('valid handshake receives hello', async () => {
    h = await startHarness();
    const { roomId, host } = await startGameAndGetRoomId(h);
    const ws = new WebSocket(`${h.wsBase}/rooms/${roomId}/game?sessionId=${host}`);
    const msg = await waitForMessage(ws);
    expect(msg).toMatchObject({ type: 'hello' });
    ws.close();
  });

  it('invalid sessionId results in close 4003', async () => {
    h = await startHarness();
    const { roomId } = await startGameAndGetRoomId(h);
    const ws = new WebSocket(`${h.wsBase}/rooms/${roomId}/game?sessionId=ghost`);
    const res = await waitForClose(ws);
    expect(res.code).toBe(4003);
  });

  it('waiting-phase connection gets a non-terminal 4006, not 4003', async () => {
    h = await startHarness();
    // Separate bearer so the shared createRoom rate-limit bucket — keyed on
    // bearer+remoteAddress, follow-up #9 in CLAUDE.md — doesn't starve the
    // next test when this one also creates a room.
    const create = await fetch(`${h.base}/v1/rooms`, {
      method: 'POST',
      headers: { authorization: 'Bearer wait-host', 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: 'Host', config: { ruleset: 'recommended', stockPileSize: 10, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null }, allowAiFill: false, visibility: 'public' }),
    });
    const { roomId } = (await create.json()) as { roomId: string };
    // Valid session + real room, but the host has not started yet — the
    // client races the "Start Game" click. Closing 4003 would flip this to
    // terminal client-side, so we use 4006 to signal "retry after backoff".
    const ws = new WebSocket(`${h.wsBase}/rooms/${roomId}/game?sessionId=wait-host`);
    const res = await waitForClose(ws);
    expect(res.code).toBe(4006);
  });

  it('duplicate session closes the older socket with 4004', async () => {
    h = await startHarness();
    const { roomId, host } = await startGameAndGetRoomId(h);
    const first = new WebSocket(`${h.wsBase}/rooms/${roomId}/game?sessionId=${host}`);
    await waitForMessage(first);
    const second = new WebSocket(`${h.wsBase}/rooms/${roomId}/game?sessionId=${host}`);
    await waitForMessage(second);
    const firstClose = await waitForClose(first);
    expect(firstClose.code).toBe(4004);
    second.close();
  });

  it('rejects upgrades with a mismatched Origin header (CSWSH defense)', async () => {
    // Defense-in-depth regression: the handshake's Origin check is the only
    // line between a configured production server and a Cross-Site WebSocket
    // Hijacking attempt. Browser `new WebSocket` locks Origin to the page
    // origin, so this test drives the Upgrade at the TCP level to spoof it.
    h = await startHarness('https://skip-bo.example');
    // Raw Upgrade with deliberately-wrong Origin. No session lookup happens
    // because the Origin check runs before path parsing — assert on the 403
    // line the handshake's `bail` helper writes back.
    const headers = [
      `GET /rooms/whatever/game?sessionId=anyone HTTP/1.1`,
      `Host: 127.0.0.1:${h.port}`,
      `Upgrade: websocket`,
      `Connection: Upgrade`,
      `Sec-WebSocket-Version: 13`,
      `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==`,
      `Origin: https://evil.example`,
      '', '',
    ].join('\r\n');
    const status = await new Promise<string>((resolve, reject) => {
      const sock = createConnection({ host: '127.0.0.1', port: h.port });
      const chunks: Buffer[] = [];
      const t = setTimeout(() => reject(new Error('origin-check-timeout')), 2000);
      sock.on('data', (b) => chunks.push(b));
      sock.on('close', () => {
        clearTimeout(t);
        resolve(Buffer.concat(chunks).toString('utf-8').split('\r\n')[0] ?? '');
      });
      sock.on('error', reject);
      sock.write(headers);
    });
    expect(status).toMatch(/^HTTP\/1\.1 403/);
  });

  it('stale close after duplicate-session kick leaves live slot state intact', async () => {
    // Regression for C-1: before the ownership guard in handleClose, the
    // evicted connection's close event fired AFTER the new connection had
    // already attached and flipped slot.connected = true. handleClose would
    // then unconditionally set connected = false and arm a 60s grace timer
    // against the live socket.
    h = await startHarness();
    // Module-level createRoom rate limiter keyed on bearer is shared across
    // tests (CLAUDE.md follow-up #9). Use distinct bearers so this 6th test
    // doesn't starve the createRoom bucket already spent by siblings.
    const { roomId, host } = await startGameAndGetRoomId(h, { host: 'stale-host', guest: 'stale-guest' });
    const first = new WebSocket(`${h.wsBase}/rooms/${roomId}/game?sessionId=${host}`);
    await waitForMessage(first);
    const second = new WebSocket(`${h.wsBase}/rooms/${roomId}/game?sessionId=${host}`);
    await waitForMessage(second);
    await waitForClose(first); // 4004
    // Let the event loop flush any straggler work the evicted conn queued.
    await new Promise((r) => setTimeout(r, 50));
    const room = h.mgr.get(roomId)!;
    const slot = room.slots[0];
    expect(slot?.kind).toBe('human');
    if (slot?.kind === 'human') {
      expect(slot.connected).toBe(true);
      expect(slot.graceDeadline).toBeNull();
      expect(slot.graceTimer).toBeNull();
    }
    second.close();
  });
});
