import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { buildHttpServer, mountRoutes } from '../src/http/server';
import { RoomManager } from '../src/room/manager';
import { LobbyStreamRegistry } from '../src/sse/registry';
import { GameRegistry } from '../src/game/registry';
import { createGameUpgradeHandler } from '../src/game/handshake';
import { installShutdown } from '../src/shutdown';

async function seedPlayingRoom(base: string) {
  const create = await fetch(`${base}/v1/rooms`, {
    method: 'POST',
    headers: { authorization: 'Bearer host', 'content-type': 'application/json' },
    body: JSON.stringify({
      playerName: 'Host',
      config: { ruleset: 'recommended', stockPileSize: 10, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null },
      allowAiFill: false,
      visibility: 'public',
    }),
  });
  const { roomId } = (await create.json()) as { roomId: string };
  await fetch(`${base}/v1/rooms/${roomId}/members`, {
    method: 'POST',
    headers: { authorization: 'Bearer guest', 'content-type': 'application/json' },
    body: JSON.stringify({ playerName: 'Guest' }),
  });
  await fetch(`${base}/v1/rooms/${roomId}/game`, { method: 'POST', headers: { authorization: 'Bearer host' } });
  return roomId;
}

function waitForClose(ws: WebSocket, timeoutMs = 2_000): Promise<{ code: number }> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('close-timeout')), timeoutMs);
    ws.once('close', (code) => { clearTimeout(t); resolve({ code }); });
  });
}

describe('installShutdown', () => {
  // Strip the signal handlers this test installs so vitest's teardown doesn't
  // re-enter shutdown on its own SIGTERM.
  const priorTermListeners = process.listeners('SIGTERM');
  const priorIntListeners = process.listeners('SIGINT');
  const priorUncaught = process.listeners('uncaughtException');
  const priorRejection = process.listeners('unhandledRejection');
  afterEach(() => {
    for (const l of process.listeners('SIGTERM')) {
      if (!priorTermListeners.includes(l)) process.off('SIGTERM', l);
    }
    for (const l of process.listeners('SIGINT')) {
      if (!priorIntListeners.includes(l)) process.off('SIGINT', l);
    }
    for (const l of process.listeners('uncaughtException')) {
      if (!priorUncaught.includes(l)) process.off('uncaughtException', l);
    }
    for (const l of process.listeners('unhandledRejection')) {
      if (!priorRejection.includes(l)) process.off('unhandledRejection', l);
    }
  });

  it('broadcasts 1001 and unblocks httpServer.close when clients are live', async () => {
    const exits: number[] = [];
    const manager = new RoomManager();
    const lobby = new LobbyStreamRegistry();
    const gameRegistry = new GameRegistry();
    const { httpServer, router } = buildHttpServer({ roomManager: manager, corsOrigin: '*' });
    mountRoutes(router, manager, { registry: lobby });
    const upgrade = createGameUpgradeHandler({ manager, registry: gameRegistry, corsOrigin: '*' });
    httpServer.on('upgrade', upgrade.handleUpgrade);
    await new Promise<void>((r) => httpServer.listen(0, r));
    const { port } = httpServer.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;
    const roomId = await seedPlayingRoom(base);

    const host = new WebSocket(`ws://127.0.0.1:${port}/rooms/${roomId}/game?sessionId=host`);
    const guest = new WebSocket(`ws://127.0.0.1:${port}/rooms/${roomId}/game?sessionId=guest`);
    await Promise.all([
      new Promise<void>((r) => host.once('open', () => r())),
      new Promise<void>((r) => guest.once('open', () => r())),
    ]);

    const shutdown = installShutdown({
      httpServer, registry: lobby, gameRegistry, roomManager: manager, upgrade,
      drainMs: 50,
      onExit: (code) => { exits.push(code); },
    });

    const hostClose = waitForClose(host);
    const guestClose = waitForClose(guest);

    // If shutdown awaited httpServer.close() before broadcasting 1001, this
    // promise would never resolve. The regression test is that it DOES resolve
    // quickly — within the drain + a small grace window.
    await Promise.race([
      shutdown(0),
      new Promise((_r, reject) => setTimeout(() => reject(new Error('shutdown hang')), 3_000)),
    ]);

    const [hr, gr] = await Promise.all([hostClose, guestClose]);
    expect(hr.code).toBe(1001);
    expect(gr.code).toBe(1001);
  });
});
