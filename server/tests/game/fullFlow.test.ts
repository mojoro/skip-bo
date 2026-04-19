import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { buildHttpServer, mountRoutes } from '../../src/http/server';
import { RoomManager } from '../../src/room/manager';
import { LobbyStreamRegistry } from '../../src/sse/registry';
import { GameRegistry } from '../../src/game/registry';
import { createGameUpgradeHandler } from '../../src/game/handshake';
import { __setGraceMsForTest } from '../../src/game/grace';
import { __setFinishCleanupMsForTest } from '../../src/room/lifecycle';

async function startHarness() {
  const mgr = new RoomManager();
  const registry = new LobbyStreamRegistry();
  const gameRegistry = new GameRegistry();
  const { httpServer, router } = buildHttpServer({ roomManager: mgr, corsOrigin: '*' });
  mountRoutes(router, mgr, { registry });
  httpServer.on('upgrade', createGameUpgradeHandler({ manager: mgr, registry: gameRegistry, corsOrigin: '*' }).handleUpgrade);
  // Mirror the production wiring: roomClosed → close every game socket 4005.
  // Without this the end-of-game test path leaks the subscriber that
  // server/src/index.ts installs.
  mgr.onRoomClosed((roomId) => {
    gameRegistry.forEachInRoom(roomId, (conn) => conn.close(4005, 'room closed'));
  });
  await new Promise<void>((r) => httpServer.listen(0, r));
  const { port } = httpServer.address() as AddressInfo;
  return {
    mgr, registry, gameRegistry,
    base: `http://127.0.0.1:${port}`, wsBase: `ws://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => httpServer.close(() => r())),
  };
}

async function startRoom(
  h: Awaited<ReturnType<typeof startHarness>>,
  bearers: { host: string; guest: string } = { host: 'host', guest: 'guest' },
) {
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

async function waitForClose(ws: WebSocket, timeoutMs = 3000): Promise<{ code: number }> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('close timeout')), timeoutMs);
    ws.once('close', (code) => { clearTimeout(t); resolve({ code }); });
  });
}

describe('game ws full flow', () => {
  let h: Awaited<ReturnType<typeof startHarness>>;
  afterEach(async () => {
    __setGraceMsForTest(null);
    __setFinishCleanupMsForTest(null);
    if (h) await h.close();
  });

  it('two clients exchange chat and see presence changes after disconnect', async () => {
    h = await startHarness();
    const { roomId } = await startRoom(h);
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

  it('grace expiry flips host seat to botControlled and the bot plays a turn', async () => {
    // Shrinking the grace window keeps the test real-time: handleClose still
    // runs the actual startGrace + maybeRunBotTurn pipeline, just on a 150 ms
    // budget so we don't sit on the 60 s production default.
    __setGraceMsForTest(150);
    h = await startHarness();
    const { roomId } = await startRoom(h, { host: 'grace-host', guest: 'grace-guest' });
    // Pin the current player to the host's seat so maybeRunBotTurn has
    // something to do when grace expires. The recommended ruleset picks the
    // starting player by top-of-stock comparison; without pinning we'd flake
    // every time the guest happened to draw highest.
    const room = h.mgr.get(roomId)!;
    const hostPlayerIndex = room.game!.players.findIndex((p) => p.id === 'grace-host');
    room.game!.currentPlayerIndex = hostPlayerIndex;
    room.game!.stateVersion += 1;
    const host = await open(h.wsBase, roomId, 'grace-host');
    const guest = await open(h.wsBase, roomId, 'grace-guest');
    const initialVersion = (guest.hello as { stateVersion: number }).stateVersion;
    expect(host.hello.type).toBe('hello');

    host.ws.close();

    // First the disconnect ticks a state with graceDeadline set, then the
    // timer expires and botControlled flips, then maybeRunBotTurn fires 800 ms
    // later and bumps stateVersion — three distinct state broadcasts.
    const botSeat = await nextJson(
      guest.ws,
      (m) => m.type === 'state' && m.view.seats.some((s: any) => s.name === 'Host' && s.botControlled === true),
      2000,
    );
    expect(botSeat).toBeTruthy();

    const botMove = await nextJson(
      guest.ws,
      (m) => m.type === 'state' && m.stateVersion > initialVersion,
      2000,
    );
    expect(botMove.stateVersion).toBeGreaterThan(initialVersion);

    guest.ws.close();
  });

  it('finishGame keeps sockets open for rematch; post-game cleanup closes them 4005', async () => {
    // Sockets must survive finishGame so the finished-state WinModal can
    // accept `requestRematch` over the same connection. The 4005 drop is
    // owned by deleteRoom when the post-game cleanup timer runs.
    __setFinishCleanupMsForTest(100);
    h = await startHarness();
    const { roomId } = await startRoom(h, { host: 'end-host', guest: 'end-guest' });
    const host = await open(h.wsBase, roomId, 'end-host');
    const guest = await open(h.wsBase, roomId, 'end-guest');

    h.mgr.finishGame(roomId, 'winner');
    // finishGame is synchronous; a short delay lets any (buggy) close frame
    // arrive before we assert the sockets are still alive.
    await new Promise((r) => setTimeout(r, 30));
    expect(host.ws.readyState).toBe(1); // OPEN
    expect(guest.ws.readyState).toBe(1);

    const [hostClose, guestClose] = await Promise.all([waitForClose(host.ws), waitForClose(guest.ws)]);
    expect(hostClose.code).toBe(4005);
    expect(guestClose.code).toBe(4005);
  });
});
