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

function open(wsBase: string, roomId: string, sessionId: string): Promise<{ ws: WebSocket; firstMsg: any }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}/rooms/${roomId}/game?sessionId=${sessionId}`);
    const t = setTimeout(() => reject(new Error('first message timeout')), 3000);
    ws.once('message', (raw) => {
      clearTimeout(t);
      resolve({ ws, firstMsg: JSON.parse(raw.toString('utf-8')) });
    });
    ws.once('error', reject);
  });
}

function waitForJson(ws: WebSocket, pred: (m: any) => boolean, timeoutMs = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('match timeout')), timeoutMs);
    function onMsg(raw: Buffer) {
      const msg = JSON.parse(raw.toString('utf-8'));
      if (pred(msg)) { clearTimeout(t); ws.off('message', onMsg); resolve(msg); }
    }
    ws.on('message', onMsg);
  });
}

// Start a room with two humans and open WS connections for both, then
// flip the in-memory room to 'finished' without calling finishGame()
// (which would emit roomClosed and 4005-close the sockets). This lets
// tests exercise the requestRematch path while both sockets are alive.
async function connectAndFinish(h: Awaited<ReturnType<typeof startHarness>>) {
  const { room } = h.mgr.create({
    sessionId: 'sess-host', playerName: 'Host',
    config: { ruleset: 'recommended', stockPileSize: 5, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null },
    allowAiFill: false, visibility: 'public',
  });
  h.mgr.addMember(room.id, { sessionId: 'sess-guest', playerName: 'Guest' });
  h.mgr.startGame(room.id, { actorSessionId: 'sess-host' });
  // Open sockets while room.phase === 'playing' (handshake requires it).
  const host = await open(h.wsBase, room.id, 'sess-host');
  const guest = await open(h.wsBase, room.id, 'sess-guest');
  // Flip to finished without calling finishGame() so sockets stay alive.
  room.phase = 'finished';
  if (room.game) room.game.phase = 'finished';
  return { room, host, guest };
}

const harnesses: Array<Awaited<ReturnType<typeof startHarness>>> = [];
afterEach(async () => {
  while (harnesses.length > 0) await harnesses.pop()!.close();
});

describe('rematch wire protocol', () => {
  it('broadcasts rematchReady to every connected socket after requestRematch', async () => {
    const h = await startHarness();
    harnesses.push(h);
    const { host, guest } = await connectAndFinish(h);

    host.ws.send(JSON.stringify({ type: 'requestRematch' }));
    const hostReady = await waitForJson(host.ws, (m) => m.type === 'rematchReady');
    const guestReady = await waitForJson(guest.ws, (m) => m.type === 'rematchReady');
    expect(hostReady.newRoomId).toBeTruthy();
    expect(guestReady.newRoomId).toBe(hostReady.newRoomId);
    host.ws.close();
    guest.ws.close();
  });

  it('second requestRematch returns the same newRoomId to the second requester only', async () => {
    const h = await startHarness();
    harnesses.push(h);
    const { host, guest } = await connectAndFinish(h);

    host.ws.send(JSON.stringify({ type: 'requestRematch' }));
    const hostReady = await waitForJson(host.ws, (m) => m.type === 'rematchReady');
    const guestReady = await waitForJson(guest.ws, (m) => m.type === 'rematchReady');
    expect(guestReady.newRoomId).toBe(hostReady.newRoomId);

    guest.ws.send(JSON.stringify({ type: 'requestRematch' }));
    const secondGuest = await waitForJson(guest.ws, (m) => m.type === 'rematchReady');
    expect(secondGuest.newRoomId).toBe(hostReady.newRoomId);
    host.ws.close();
    guest.ws.close();
  });

  it('emits actionError when game is not finished', async () => {
    const h = await startHarness();
    harnesses.push(h);
    const { room } = h.mgr.create({
      sessionId: 'sess-host', playerName: 'Host',
      config: { ruleset: 'recommended', stockPileSize: 5, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null },
      allowAiFill: false, visibility: 'public',
    });
    h.mgr.addMember(room.id, { sessionId: 'sess-guest', playerName: 'Guest' });
    h.mgr.startGame(room.id, { actorSessionId: 'sess-host' });
    const host = await open(h.wsBase, room.id, 'sess-host');

    host.ws.send(JSON.stringify({ type: 'requestRematch' }));
    const err = await waitForJson(host.ws, (m) => m.type === 'actionError');
    expect(err.reason).toBe('notFinished');
    host.ws.close();
  });

  it('first human to attach in the rematch room claims host', async () => {
    const h = await startHarness();
    harnesses.push(h);
    const { room, host, guest: origGuest } = await connectAndFinish(h);

    host.ws.send(JSON.stringify({ type: 'requestRematch' }));
    const ready = await waitForJson(host.ws, (m) => m.type === 'rematchReady');
    // Close both original-room sockets before connecting to rematch room.
    host.ws.close();
    origGuest.ws.close();

    // Guest attaches first to the rematch room — they should claim host.
    // Slot 0 is 'sess-host' (slotIndex 0), slot 1 is 'sess-guest' (slotIndex 1).
    // Both are botControlled in the rematch room. The first human to attach
    // triggers migrateHostAwayFromBot, claiming host away from the slot-0 bot.
    const rematchGuest = await open(h.wsBase, ready.newRoomId, 'sess-guest');
    expect(rematchGuest.firstMsg.type).toBe('hello');
    const seats = rematchGuest.firstMsg.view.seats as Array<{ slotIndex: number; isHost: boolean; connected: boolean }>;
    const guestSeat = seats.find((s: any) => s.slotIndex === 1);
    const hostSeat = seats.find((s: any) => s.slotIndex === 0);
    expect(guestSeat?.connected).toBe(true);
    expect(hostSeat?.connected).toBe(false);
    expect(guestSeat?.isHost).toBe(true);
    expect(hostSeat?.isHost).toBe(false);
    rematchGuest.ws.close();
  });
});
