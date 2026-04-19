import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { buildHttpServer, mountRoutes } from '../../src/http/server';
import { RoomManager } from '../../src/room/manager';
import { LobbyStreamRegistry } from '../../src/sse/registry';
import { GameRegistry } from '../../src/game/registry';
import { createGameUpgradeHandler } from '../../src/game/handshake';
import { broadcastRoomState } from '../../src/game/broadcast';

async function startHarness() {
  const mgr = new RoomManager();
  const registry = new LobbyStreamRegistry();
  const gameRegistry = new GameRegistry();
  const { httpServer, router } = buildHttpServer({ roomManager: mgr, corsOrigin: '*' });
  mountRoutes(router, mgr, { registry });
  httpServer.on(
    'upgrade',
    createGameUpgradeHandler({ manager: mgr, registry: gameRegistry, corsOrigin: '*' }).handleUpgrade,
  );
  // Mirror production wiring: roomClosed → close all game sockets 4005.
  mgr.onRoomClosed((roomId) => {
    gameRegistry.forEachInRoom(roomId, (conn) => conn.close(4005, 'room closed'));
  });
  // Mirror production wiring: REST mutations → broadcast state to connected sockets.
  mgr.onRoomStateChange((roomId) => {
    const room = mgr.get(roomId);
    if (!room) return;
    broadcastRoomState(room, gameRegistry);
  });
  await new Promise<void>((r) => httpServer.listen(0, r));
  const { port } = httpServer.address() as AddressInfo;
  return {
    mgr, registry, gameRegistry,
    base: `http://127.0.0.1:${port}`, wsBase: `ws://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => httpServer.close(() => r())),
  };
}

function waitForMessage(ws: WebSocket, pred: (m: unknown) => boolean, timeoutMs = 3000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('waitForMessage timeout')), timeoutMs);
    function onMsg(raw: Buffer) {
      const msg = JSON.parse(raw.toString('utf-8'));
      if (pred(msg)) { clearTimeout(t); ws.off('message', onMsg); resolve(msg); }
    }
    ws.on('message', onMsg);
  });
}

describe('broadcast waiting-phase state', () => {
  let h: Awaited<ReturnType<typeof startHarness>>;
  afterEach(async () => { if (h) await h.close(); });

  it('connected host receives state frame when a guest joins the waiting room', async () => {
    h = await startHarness();

    // Create a room with unique bearer to avoid rate-limit collisions (CLAUDE.md follow-up #9).
    const create = await fetch(`${h.base}/v1/rooms`, {
      method: 'POST',
      headers: { authorization: 'Bearer bcast-host', 'content-type': 'application/json' },
      body: JSON.stringify({
        playerName: 'Host',
        config: { ruleset: 'recommended', stockPileSize: 10, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null },
        allowAiFill: false,
        visibility: 'public',
      }),
    });
    const { roomId } = (await create.json()) as { roomId: string };

    // Host opens a WS connection while the room is still in waiting phase.
    const ws = new WebSocket(`${h.wsBase}/rooms/${roomId}/game?sessionId=bcast-host`);

    // Drain the hello first, then arm the state-message listener.
    const hello = await new Promise<unknown>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('hello timeout')), 3000);
      ws.once('message', (raw) => { clearTimeout(t); resolve(JSON.parse(raw.toString('utf-8'))); });
      ws.once('error', reject);
    });
    expect((hello as { type: string }).type).toBe('hello');

    // Register promise for the next `state` frame before triggering the mutation.
    const statePromise = waitForMessage(ws, (m) => (m as { type: string }).type === 'state');

    // Guest joins via REST — this should trigger broadcastRoomState.
    await fetch(`${h.base}/v1/rooms/${roomId}/members`, {
      method: 'POST',
      headers: { authorization: 'Bearer bcast-guest', 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: 'Guest' }),
    });

    const state = (await statePromise) as {
      type: string;
      stateVersion: number;
      view: { view: unknown; seats: { kind: string; name: string | null }[] };
    };

    expect(state.type).toBe('state');
    // Room is still waiting — no game in progress — so view.view must be null.
    expect(state.view.view).toBeNull();
    // Seats should reflect both the host and the newly-joined guest (at least 2 human seats).
    const humanSeats = state.view.seats.filter((s) => s.kind === 'human');
    expect(humanSeats.length).toBeGreaterThanOrEqual(2);

    ws.close();
  });

  it('connected host receives state frame with playing-phase view when game starts', async () => {
    h = await startHarness();

    const create = await fetch(`${h.base}/v1/rooms`, {
      method: 'POST',
      headers: { authorization: 'Bearer bcast-start-host', 'content-type': 'application/json' },
      body: JSON.stringify({
        playerName: 'Host',
        config: { ruleset: 'recommended', stockPileSize: 10, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null },
        allowAiFill: false,
        visibility: 'public',
      }),
    });
    const { roomId } = (await create.json()) as { roomId: string };

    // Guest joins so the game can start.
    await fetch(`${h.base}/v1/rooms/${roomId}/members`, {
      method: 'POST',
      headers: { authorization: 'Bearer bcast-start-guest', 'content-type': 'application/json' },
      body: JSON.stringify({ playerName: 'Guest' }),
    });

    // Host connects to the waiting-phase socket.
    const ws = new WebSocket(`${h.wsBase}/rooms/${roomId}/game?sessionId=bcast-start-host`);

    // Wait for hello.
    await new Promise<unknown>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('hello timeout')), 3000);
      ws.once('message', (raw) => { clearTimeout(t); resolve(JSON.parse(raw.toString('utf-8'))); });
      ws.once('error', reject);
    });

    // Arm state listener before triggering startGame.
    const statePromise = waitForMessage(ws, (m) => (m as { type: string }).type === 'state');

    // Host starts the game via REST.
    await fetch(`${h.base}/v1/rooms/${roomId}/game`, {
      method: 'POST',
      headers: { authorization: 'Bearer bcast-start-host' },
    });

    const state = (await statePromise) as {
      type: string;
      stateVersion: number;
      view: { view: unknown; seats: unknown[] };
    };

    expect(state.type).toBe('state');
    // Room is now playing — view.view should be a non-null PlayerView.
    expect(state.view.view).not.toBeNull();

    ws.close();
  });
});
