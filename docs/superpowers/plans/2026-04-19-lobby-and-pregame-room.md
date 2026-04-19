# Lobby + Pre-Game Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a browser lobby at `/` and an AoE2-style pre-game room view at `/rooms/[roomId]` (during `phase === 'waiting'`), closing the gap between the finished WinModal "Play online" button and playing a networked Skip-Bo game.

**Architecture:** Relax the game WebSocket handshake to accept waiting-phase connections so one socket covers both pre-game and in-game views. Widen `PlayerView.view` to `PublicPlayerView | null` and add `GameView.hostSlotIndex`. Build a lobby page subscribed to the existing `/v1/lobby/stream` SSE feed, and a `<PreGameRoom>` component that renders the seats + config + chat out of the same socket the Board consumes during play.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Tailwind 4, Vitest, raw `ws@8` on server, custom hand-rolled DnD + WebSocket client. No external lobby/room-state library — everything goes through the server team already built (`server/` package).

**Spec:** `docs/superpowers/specs/2026-04-19-lobby-and-pregame-room-design.md`.

---

## Branch + orchestration notes

This plan is for a blank-context Sonnet 4.6 parallel orchestrator. Each task is a self-contained unit suitable for dispatching to a fresh subagent. Dependencies are stated at the top of each task. Where multiple tasks share a phase and have no inter-dependency, dispatch them in parallel.

**Workspace:** New branch `feature/section-6.5-lobby` from the head of `feature/section-6-networked-board`.

```bash
git worktree add ../skip-bo-6.5 -b feature/section-6.5-lobby feature/section-6-networked-board
cd ../skip-bo-6.5
```

**Commands the orchestrator will need:**

```bash
# Root (Next.js app)
npm install          # first time only
npm run dev          # next dev (port 3000 by default; use :3001 if :3000 is in use)
npm test             # vitest run
npx tsc --noEmit     # typecheck (root — ignore pre-existing @engine/* errors under server/, follow-up #13)

# Server
cd server
npm install          # first time only
npm run build && npm start   # esbuild → node dist/index.js (on port 8787)
npm test             # vitest run
npx tsc --noEmit     # typecheck (should be clean)
```

**Env:** `.env.local` at repo root must contain `NEXT_PUBLIC_GAME_WS_URL=ws://localhost:8787` and `NEXT_PUBLIC_GAME_API_URL=http://localhost:8787` before the lobby page can reach the server. Create it if absent.

**Commit conventions (hard rules):**
- Single-line subject, imperative, completing "This commit will…". No body. No Co-Authored-By. No Conventional-Commits prefix. ≤75 characters.
- Atomic commits — one logical change per commit. Commit as you go.
- Never chain bash commands with `&&` / `;` / `||` when running from this orchestrator.
- Never skip hooks (`--no-verify`) or sign (`--no-gpg-sign`).

---

## Dependency graph

```
Task 0 (branch setup) ──┬─→ Task 1 (protocol types) ──┬─→ Task 2 (server view nullable)
                        │                              ├─→ Task 3 (handshake relaxation)
                        │                              └─→ Task 4 (broadcastWaitingState)
                        │
                        ├─→ Task 5 (shared room code module)
                        ├─→ Task 6 (useDisplayName)
                        ├─→ Task 7 (api.ts)
                        ├─→ Task 8 (useLobbyStream)
                        └─→ Task 9 (NewGameModal edit mode)

Tasks 5–9 parallel.  Tasks 2–4 parallel (after Task 1).

Phase 3 (after Phase 1+2 done):
  Tasks 10–18 (small components) — all parallel.

Phase 4 (after Phase 3):
  Tasks 19–23 (assembly) — serial.

Phase 5 (after Phase 4):
  Tasks 24–26 (integration + browser verify) — serial.
```

---

## Phase 0 — Branch setup

### Task 0: Create the section-6.5 worktree and baseline

**Files:** none modified. Worktree setup only.

- [ ] **Step 1: Create worktree and branch off section-6 head**

```bash
git worktree add ../skip-bo-6.5 -b feature/section-6.5-lobby feature/section-6-networked-board
cd ../skip-bo-6.5
```

- [ ] **Step 2: Install deps at both roots**

```bash
npm install
cd server
npm install
cd ..
```

- [ ] **Step 3: Verify baseline suite green**

```bash
npm test
```

Expected: `Test Files  10 passed (10)`, `Tests  96 passed (96)`.

```bash
cd server
npm test
cd ..
```

Expected: `Test Files  26 passed (26)`, `Tests  135 passed (135)`.

- [ ] **Step 4: Create `.env.local` if missing**

Check for file existence first. If absent:

```bash
cat > .env.local <<'EOF'
NEXT_PUBLIC_GAME_WS_URL=ws://localhost:8787
NEXT_PUBLIC_GAME_API_URL=http://localhost:8787
EOF
```

- [ ] **Step 5: No commit — this task only establishes the workspace**

---

## Phase 1 — Protocol + server foundation

### Task 1: Widen protocol types for nullable view + hostSlotIndex

**Blocks:** Tasks 2, 3, 4. Enables the pre-game room to share the Board's socket.

**Files:**
- Modify: `src/lib/net/protocol.ts`
- Modify: `src/lib/net/protocol.test.ts`
- Modify: `server/src/game/protocol.ts`

- [ ] **Step 1: Write failing client protocol tests**

Open `src/lib/net/protocol.test.ts` and append to the existing describe block:

```typescript
import type { GameView, PlayerView } from './protocol';

describe('PlayerView null view', () => {
  it('accepts view: null for waiting phase', () => {
    const waiting: PlayerView = {
      config: { ruleset: 'recommended', stockPileSize: 10, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null },
      phase: 'waiting',
      turnPhase: 'play',
      currentPlayerSlotIndex: 0,
      youSlotIndex: 0,
      winningTeamIndex: null,
      stateVersion: 0,
      buildPiles: [],
      drawPileCount: 0,
      you: { name: 'You', hand: [], stockPile: [], discardPiles: [[],[],[],[]] },
      opponents: [],
    };
    expect(waiting.phase).toBe('waiting');
  });

  it('GameView carries hostSlotIndex', () => {
    const view: GameView = {
      view: null,
      seats: [],
      hostSlotIndex: 0,
    };
    expect(view.hostSlotIndex).toBe(0);
    expect(view.view).toBe(null);
  });
});
```

- [ ] **Step 2: Run it to verify it fails compile**

```bash
npx tsc --noEmit
```

Expected: errors on `view: null` (PlayerView not nullable yet) and `hostSlotIndex` (not a property of GameView).

- [ ] **Step 3: Widen `PlayerView.view` and add `GameView.hostSlotIndex`**

In `src/lib/net/protocol.ts`, find the existing `GameView` definition:

```typescript
export interface GameView {
  view: PlayerView;
  seats: GameViewSeat[];
}
```

Replace with:

```typescript
export interface GameView {
  // `view` is null while `room.phase === 'waiting'` (no engine state yet).
  // Consumers switch on `view === null` to render the pre-game room.
  view: PlayerView | null;
  seats: GameViewSeat[];
  // Slot index of the current host human, or null if no human holds the role
  // (rare: every seated human is bot-controlled and migrateHostAwayFromBot has
  // nothing to promote). Clients use this to gate host-only actions.
  hostSlotIndex: number | null;
}
```

- [ ] **Step 4: Run client tests to verify they pass**

```bash
npx tsc --noEmit
npm test -- protocol
```

Expected: PASS.

- [ ] **Step 5: Mirror change on server**

Check `server/src/game/protocol.ts`. Find the `ServerMessageSchema` Zod schemas and the `GameView` / `PlayerView` type definitions it references. Apply the matching nullability + `hostSlotIndex` additions. Keep the Zod schemas tolerant of `view: null`:

```typescript
// in server/src/game/protocol.ts, wherever GameViewSchema is defined:
const GameViewSchema = z.object({
  view: PlayerViewSchema.nullable(),
  seats: z.array(GameViewSeatSchema),
  hostSlotIndex: z.number().int().nullable(),
});
```

Exact field names depend on how the server's protocol.ts is structured. Read the file first, then match the existing shape.

- [ ] **Step 6: Run server typecheck + tests**

```bash
cd server
npx tsc --noEmit
npm test
cd ..
```

Expected: server tests still pass (typing widened; server runtime builders still return `view: populated`, so tests see no change). Fix compile errors in server view builders by inlining `hostSlotIndex: null` returns temporarily — Task 2 fills them in properly.

- [ ] **Step 7: Commit**

```bash
git add src/lib/net/protocol.ts src/lib/net/protocol.test.ts server/src/game/protocol.ts
git commit -m "Widen PlayerView.view to nullable and add GameView.hostSlotIndex"
```

---

### Task 2: Server view builders tolerate null game

**Depends on:** Task 1.
**Parallel with:** Task 3, Task 4.

**Files:**
- Modify: `server/src/game/view.ts`
- Modify: `server/tests/game/view.test.ts`

- [ ] **Step 1: Write failing test for waiting-phase view**

Append to `server/tests/game/view.test.ts`:

```typescript
import { buildGameView, buildSeats } from '../../src/game/view';
import { RoomManager } from '../../src/room/manager';

describe('buildGameView when room.game is null', () => {
  it('returns view: null, populated seats, and hostSlotIndex', () => {
    const mgr = new RoomManager();
    const { room } = mgr.create({
      sessionId: 'host-1',
      playerName: 'Host',
      config: { ruleset: 'recommended', stockPileSize: 10, handSize: 5, bidirectionalBuild: true, maxPlayers: 3, partnership: null },
      allowAiFill: true,
      visibility: 'public',
    });
    // room.phase is 'waiting'; room.game is null here.
    const gv = buildGameView(room, 'host-1');
    expect(gv.view).toBeNull();
    expect(gv.seats).toHaveLength(3);
    expect(gv.seats[0]).toMatchObject({ kind: 'human', name: 'Host', isHost: true });
    expect(gv.hostSlotIndex).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd server
npm test -- view.test
```

Expected: FAIL — `buildGameView` currently requires `room.game`.

- [ ] **Step 3: Update `buildGameView` to handle null game**

Read `server/src/game/view.ts`. Find `buildGameView`. Wrap the existing logic:

```typescript
export function buildGameView(room: Room, viewerSessionId: string, seats?: GameViewSeat[]): GameView {
  const resolvedSeats = seats ?? buildSeats(room);
  const hostSlotIndex = resolveHostSlotIndex(room);
  if (room.game === null) {
    return { view: null, seats: resolvedSeats, hostSlotIndex };
  }
  // ...existing logic that builds PlayerView from room.game...
  const view = /* existing PlayerView construction */;
  return { view, seats: resolvedSeats, hostSlotIndex };
}

function resolveHostSlotIndex(room: Room): number | null {
  const idx = room.slots.findIndex(
    (s) => s.kind === 'human' && s.sessionId === room.hostSessionId,
  );
  return idx >= 0 ? idx : null;
}
```

Make sure every `return` path in `buildGameView` (playing, finished) now includes `hostSlotIndex`.

- [ ] **Step 4: Run server tests to verify pass**

```bash
npm test
```

Expected: `Test Files  26 passed (26)` + the new view test.

- [ ] **Step 5: Commit**

```bash
cd ..
git add server/src/game/view.ts server/tests/game/view.test.ts
git commit -m "Build waiting-phase GameView with null view and hostSlotIndex"
```

---

### Task 3: Relax handshake to accept waiting-phase upgrades

**Depends on:** Task 1.
**Parallel with:** Task 2, Task 4.

**Files:**
- Modify: `server/src/game/handshake.ts:99-109`
- Modify: `server/tests/game/handshake.test.ts` (or whichever test file covers the 4006 path)

- [ ] **Step 1: Find the existing handshake test file**

```bash
grep -rn "4006" server/tests
```

Use that file. If no matching test file exists, create `server/tests/game/handshake.waiting.test.ts`.

- [ ] **Step 2: Write failing test for waiting-phase accept**

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { buildHttpServer, mountRoutes } from '../../src/http/server';
import { RoomManager } from '../../src/room/manager';
import { LobbyStreamRegistry } from '../../src/sse/registry';
import { GameRegistry } from '../../src/game/registry';
import { createGameUpgradeHandler } from '../../src/game/handshake';

describe('handshake waiting-phase acceptance', () => {
  let close: () => Promise<void>;
  afterEach(async () => { if (close) await close(); });

  it('accepts upgrade when phase === waiting', async () => {
    const mgr = new RoomManager();
    const registry = new LobbyStreamRegistry();
    const gameRegistry = new GameRegistry();
    const { httpServer, router } = buildHttpServer({ roomManager: mgr, corsOrigin: '*' });
    mountRoutes(router, mgr, { registry });
    httpServer.on('upgrade', createGameUpgradeHandler({ manager: mgr, registry: gameRegistry, corsOrigin: '*' }).handleUpgrade);
    await new Promise<void>((r) => httpServer.listen(0, r));
    const { port } = httpServer.address() as AddressInfo;
    close = () => new Promise<void>((r) => httpServer.close(() => r()));

    const { room } = mgr.create({
      sessionId: 'host',
      playerName: 'Host',
      config: { ruleset: 'recommended', stockPileSize: 10, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null },
      allowAiFill: false,
      visibility: 'public',
    });
    expect(room.phase).toBe('waiting');

    const ws = new WebSocket(`ws://127.0.0.1:${port}/rooms/${room.id}/game?sessionId=host`);
    const hello = await new Promise<any>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('hello timeout')), 2000);
      ws.once('message', (raw) => { clearTimeout(t); resolve(JSON.parse(raw.toString('utf-8'))); });
      ws.once('error', reject);
    });
    expect(hello.type).toBe('hello');
    expect(hello.view.view).toBeNull();
    expect(hello.view.seats).toHaveLength(2);
    ws.close();
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
cd server
npm test -- handshake
```

Expected: FAIL — handshake rejects with 4006 when phase !== 'playing'.

- [ ] **Step 4: Relax the handshake guard**

In `server/src/game/handshake.ts`, find:

```typescript
if (room.phase !== 'playing') {
  wss.handleUpgrade(req, socket, head, (ws) => {
    socket.removeListener('error', onSocketError);
    ws.close(4006, 'room not playing');
  });
  return;
}
```

Replace with:

```typescript
if (room.phase !== 'playing' && room.phase !== 'waiting') {
  wss.handleUpgrade(req, socket, head, (ws) => {
    socket.removeListener('error', onSocketError);
    ws.close(4006, 'room not playing');
  });
  return;
}
```

- [ ] **Step 5: Verify the existing 4006-on-finished test still passes**

```bash
npm test -- handshake
```

Expected: new test + existing tests all PASS. If any test assumed waiting→4006, update it to test finished→4006 instead.

- [ ] **Step 6: Commit**

```bash
cd ..
git add server/src/game/handshake.ts server/tests/game/handshake*.test.ts
git commit -m "Accept waiting-phase upgrades on the game WebSocket handshake"
```

---

### Task 4: broadcastWaitingState helper wired into REST mutations

**Depends on:** Task 1 (uses nullable view), Task 2 (view builder), Task 3 (sockets can exist during waiting).
**Parallel with:** nothing after Tasks 1-3 land.

**Files:**
- Create: `server/src/game/broadcast.ts`
- Modify: `server/src/index.ts` (wire the helper)
- Modify: `server/src/room/manager.ts` (call broadcast after each mutation)
- Create: `server/tests/game/broadcast.waiting.test.ts`

- [ ] **Step 1: Write the broadcast helper**

Create `server/src/game/broadcast.ts`:

```typescript
import type { Room } from '../types';
import type { GameRegistry } from './registry';
import type { ServerMessage } from './protocol';
import { buildGameView, buildSeats } from './view';

// Broadcast the current room state to every attached game socket. Used by
// both playing-phase afterCommit and waiting-phase REST mutations — one
// canonical path for "something in this room changed, fan out a state frame".
export function broadcastRoomState(room: Room, registry: GameRegistry): void {
  const seats = buildSeats(room);
  const stateVersion = room.game?.stateVersion ?? 0;
  registry.forEachInRoom(room.id, (conn) => {
    try {
      const view = buildGameView(room, conn.sessionId, seats);
      const msg: ServerMessage = { type: 'state', stateVersion, view };
      conn.send(msg);
    } catch (err) {
      // Swallow per-connection errors; one bad socket must not break the fanout.
    }
  });
}
```

- [ ] **Step 2: Write failing test for the helper**

Create `server/tests/game/broadcast.waiting.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { buildHttpServer, mountRoutes } from '../../src/http/server';
import { RoomManager } from '../../src/room/manager';
import { LobbyStreamRegistry } from '../../src/sse/registry';
import { GameRegistry } from '../../src/game/registry';
import { createGameUpgradeHandler } from '../../src/game/handshake';

describe('waiting-phase broadcast', () => {
  let close: () => Promise<void>;
  afterEach(async () => { if (close) await close(); });

  it('fans out a state frame to every attached socket when addMember fires', async () => {
    const mgr = new RoomManager();
    const registry = new LobbyStreamRegistry();
    const gameRegistry = new GameRegistry();
    const { httpServer, router } = buildHttpServer({ roomManager: mgr, corsOrigin: '*' });
    mountRoutes(router, mgr, { registry, gameRegistry });
    httpServer.on('upgrade', createGameUpgradeHandler({ manager: mgr, registry: gameRegistry, corsOrigin: '*' }).handleUpgrade);
    await new Promise<void>((r) => httpServer.listen(0, r));
    const { port } = httpServer.address() as AddressInfo;
    close = () => new Promise<void>((r) => httpServer.close(() => r()));

    const { room } = mgr.create({
      sessionId: 'host',
      playerName: 'Host',
      config: { ruleset: 'recommended', stockPileSize: 10, handSize: 5, bidirectionalBuild: true, maxPlayers: 4, partnership: null },
      allowAiFill: false,
      visibility: 'public',
    });

    const hostWs = new WebSocket(`ws://127.0.0.1:${port}/rooms/${room.id}/game?sessionId=host`);
    await new Promise<void>((r) => hostWs.once('open', () => r()));
    await new Promise<void>((r) => hostWs.once('message', () => r())); // hello

    const stateFrame = new Promise<any>((resolve) => {
      hostWs.on('message', (raw) => {
        const msg = JSON.parse(raw.toString('utf-8'));
        if (msg.type === 'state') resolve(msg);
      });
    });

    mgr.addMember(room.id, { sessionId: 'guest', playerName: 'Guest' });

    const state = await stateFrame;
    expect(state.view.view).toBeNull();
    expect(state.view.seats.filter((s: any) => s.kind === 'human')).toHaveLength(2);
    hostWs.close();
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
cd server
npm test -- broadcast.waiting
```

Expected: FAIL — `mountRoutes` signature doesn't accept `gameRegistry` yet, or the broadcast doesn't fire.

- [ ] **Step 4: Wire broadcast into RoomManager mutations**

`broadcastRoomState` needs access to the `GameRegistry`. Two clean wiring options:
- (a) Pass `GameRegistry` into `RoomManager.markUpdated` / each mutation (invasive).
- (b) Expose a subscriber pattern on `RoomManager` that the game layer subscribes to at startup.

Use (b). Open `server/src/room/manager.ts`:

Add to the class:

```typescript
// Fires on any state change to a waiting room so the game-layer can fan out
// a `state` frame over the game WS to every connected member. The lobby SSE
// `roomUpdated` emit is independent — that's for the global rooms list, not
// for the in-room socket subscribers.
onWaitingStateChange(handler: (roomId: string) => void): () => void {
  this.internalEvents.on('waitingStateChange', handler);
  return () => this.internalEvents.off('waitingStateChange', handler);
}

private emitWaitingStateChange(room: Room): void {
  if (room.phase !== 'waiting') return;
  this.internalEvents.emit('waitingStateChange', room.id);
}
```

Then call `this.emitWaitingStateChange(room)` at the end of every mutation in waiting phase:
- `addMember` — after `emitRoomUpdated(room)`.
- `removeMember` — after the existing `emitRoomUpdated` call (the non-empty, non-delete branch).
- `setSlot` — after `emitRoomUpdated(room)`.
- `markUpdated` — after `emitRoomUpdated(room)` (covers `patchRoom` via HTTP handler).

Subscribe in `server/src/index.ts`:

```typescript
import { broadcastRoomState } from './game/broadcast';

// ...inside main() after gameRegistry + roomManager are constructed:
roomManager.onWaitingStateChange((roomId) => {
  const room = roomManager.get(roomId);
  if (!room) return;
  broadcastRoomState(room, gameRegistry);
});
```

- [ ] **Step 5: Wire the test harness the same way**

In `broadcast.waiting.test.ts` before the WS connection, after the RoomManager is constructed:

```typescript
mgr.onWaitingStateChange((roomId) => {
  const room = mgr.get(roomId);
  if (!room) return;
  const { broadcastRoomState } = require('../../src/game/broadcast');
  broadcastRoomState(room, gameRegistry);
});
```

(Use `import` at the top of the file instead of `require` for ESM cleanliness.)

- [ ] **Step 6: Run tests**

```bash
npm test -- broadcast
```

Expected: PASS.

```bash
npm test
```

Expected: full suite passes (26+ files, test count grew by several).

- [ ] **Step 7: Commit**

```bash
cd ..
git add server/src/game/broadcast.ts server/src/index.ts server/src/room/manager.ts server/tests/game/broadcast.waiting.test.ts
git commit -m "Broadcast room state to waiting-phase sockets on REST mutations"
```

---

### Task 5: Shared normalizeRoomCode module

**Depends on:** Task 0 only.
**Parallel with:** Tasks 1-4, 6-9.

**Files:**
- Create: `src/lib/room/code.ts`
- Create: `src/lib/room/code.test.ts`
- Modify: `server/src/room/code.ts` (re-export or delegate)

- [ ] **Step 1: Read the server's existing rule**

```bash
cat server/src/room/code.ts
```

Note the `normalizeRoomCode` implementation (trim, uppercase, strip dashes, whatever the server currently does) and the code alphabet used by `generateRoomCode`.

- [ ] **Step 2: Write failing test in the shared module**

Create `src/lib/room/code.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { normalizeRoomCode } from './code';

describe('normalizeRoomCode', () => {
  it('uppercases and strips whitespace', () => {
    expect(normalizeRoomCode('abcd-123  ')).toBe('ABCD-123');
  });

  it('collapses internal whitespace', () => {
    expect(normalizeRoomCode('  abcd 123 ')).toBe('ABCD123');
  });

  it('returns empty string for non-string input', () => {
    // @ts-expect-error — intentional runtime check
    expect(normalizeRoomCode(null)).toBe('');
  });
});
```

Adjust expectations to match what server's `normalizeRoomCode` does today — copy the logic verbatim.

- [ ] **Step 3: Create the shared module**

Create `src/lib/room/code.ts` by porting the server's logic. Example (replace with the server's actual rule):

```typescript
export function normalizeRoomCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}
```

- [ ] **Step 4: Run the test**

```bash
npm test -- code.test
```

Expected: PASS.

- [ ] **Step 5: Delegate server's code.ts to the shared module**

Update `server/src/room/code.ts` to re-export `normalizeRoomCode` from the client-shared module. The server package root is `server/`, so the relative path reaches up to the repo root: `../../../src/lib/room/code`.

```typescript
// server/src/room/code.ts
export { normalizeRoomCode } from '../../../src/lib/room/code';

// generateRoomCode stays server-only — the client never mints codes.
import { randomInt } from 'node:crypto';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // keep existing alphabet
export function generateRoomCode(): string {
  // ...existing implementation unchanged...
}
```

If server/tsconfig.json doesn't have `../../../src` in scope, add it to `include`. If path collisions arise, prefer leaving server's `normalizeRoomCode` in place and just duplicating the rule in client (DRY loss acceptable for 5 lines of code).

- [ ] **Step 6: Run server typecheck + tests**

```bash
cd server
npx tsc --noEmit
npm test
cd ..
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/lib/room/code.ts src/lib/room/code.test.ts server/src/room/code.ts
git commit -m "Share normalizeRoomCode between server and browser"
```

---

## Phase 2 — Client hooks + NewGameModal edit mode

### Task 6: useDisplayName hook

**Depends on:** Task 0.
**Parallel with:** Tasks 1-5, 7-9.

**Files:**
- Create: `src/lib/net/useDisplayName.ts`
- Create: `src/lib/net/useDisplayName.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/lib/net/useDisplayName.test.tsx`:

```typescript
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDisplayName } from './useDisplayName';

describe('useDisplayName', () => {
  beforeEach(() => localStorage.clear());

  it('returns null on first render before the mount effect runs', () => {
    const { result } = renderHook(() => useDisplayName());
    expect(result.current[0]).toBeNull();
  });

  it('reads from localStorage after mount', () => {
    localStorage.setItem('skipboDisplayName', 'Alice');
    const { result } = renderHook(() => useDisplayName());
    // After the mount effect runs, the state picks up the stored value.
    expect(result.current[0]).toBe('Alice');
  });

  it('setName writes through to localStorage', () => {
    const { result } = renderHook(() => useDisplayName());
    act(() => result.current[1]('Bob'));
    expect(localStorage.getItem('skipboDisplayName')).toBe('Bob');
    expect(result.current[0]).toBe('Bob');
  });
});
```

- [ ] **Step 2: Confirm @testing-library/react is installed**

```bash
grep '@testing-library/react' package.json
```

If absent, install:

```bash
npm install --save-dev @testing-library/react @testing-library/dom
```

- [ ] **Step 3: Run the test to see it fail**

```bash
npm test -- useDisplayName
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement the hook**

Create `src/lib/net/useDisplayName.ts`:

```typescript
'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'skipboDisplayName';

// Mirrors the `useSessionId` pattern in the same folder: localStorage-backed,
// returns null until the mount effect runs so SSR + first client render agree.
// Callers gate UI (e.g., "Pick a name" landing panel) on name === null.
export function useDisplayName(): [string | null, (next: string) => void] {
  const [name, setNameState] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setNameState(stored);
  }, []);

  const setName = useCallback((next: string) => {
    const trimmed = next.trim();
    if (trimmed.length === 0) return;
    localStorage.setItem(STORAGE_KEY, trimmed);
    setNameState(trimmed);
  }, []);

  return [name, setName];
}
```

- [ ] **Step 5: Run the test to see it pass**

```bash
npm test -- useDisplayName
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/net/useDisplayName.ts src/lib/net/useDisplayName.test.tsx
git commit -m "Add useDisplayName hook backed by localStorage"
```

---

### Task 7: api.ts REST wrappers

**Depends on:** Task 0.
**Parallel with:** Tasks 1-6, 8-9.

**Files:**
- Create: `src/lib/net/api.ts`
- Create: `src/lib/net/api.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/net/api.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoom, joinRoom, findRoomByCode, ApiError } from './api';

const baseUrl = 'http://localhost:8787';

describe('api.createRoom', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('POSTs to /v1/rooms with bearer header and returns the roomId + code', async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response(
      JSON.stringify({ roomId: 'abc', code: 'GOLD-42' }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    ));
    const result = await createRoom({
      baseUrl,
      sessionId: 's-1',
      body: {
        playerName: 'Alice',
        config: { ruleset: 'recommended', stockPileSize: 10, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null },
        allowAiFill: false,
        visibility: 'public',
      },
    });
    expect(result).toEqual({ roomId: 'abc', code: 'GOLD-42' });
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe(`${baseUrl}/v1/rooms`);
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer s-1');
  });

  it('throws a typed ApiError for Problem+JSON 4xx response', async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response(
      JSON.stringify({ type: 'tag:skip-bo/full', title: 'Full', status: 409, detail: 'Room is full.' }),
      { status: 409, headers: { 'content-type': 'application/problem+json' } },
    ));
    await expect(joinRoom({ baseUrl, sessionId: 's-1', roomId: 'r', playerName: 'A' }))
      .rejects.toMatchObject({ status: 409, detail: 'Room is full.' });
  });
});

describe('api.findRoomByCode', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('returns the first matching room or null', async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response(
      JSON.stringify({ rooms: [{ id: 'r-1', code: 'GOLD-42' }], stats: {} }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    const room = await findRoomByCode({ baseUrl, code: 'GOLD-42' });
    expect(room).toMatchObject({ id: 'r-1' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- api.test
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement api.ts**

Create `src/lib/net/api.ts`:

```typescript
import type { GameConfig } from '@/lib/game/types';
import type { RoomInfo } from './protocol';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly title: string,
    public readonly detail: string | null,
    public readonly reason: string | null,
  ) {
    super(`${status} ${title}${detail ? ` — ${detail}` : ''}`);
  }
}

interface WithAuth {
  baseUrl: string;
  sessionId: string;
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (res.ok) return res.json() as Promise<T>;
  const ctype = res.headers.get('content-type') ?? '';
  if (ctype.includes('application/problem+json')) {
    const body = (await res.json().catch(() => ({}))) as {
      title?: string; detail?: string; reason?: string;
    };
    throw new ApiError(res.status, body.title ?? res.statusText, body.detail ?? null, body.reason ?? null);
  }
  throw new ApiError(res.status, res.statusText, null, null);
}

function authHeaders(sessionId: string): HeadersInit {
  return {
    authorization: `Bearer ${sessionId}`,
    'content-type': 'application/json',
  };
}

export interface CreateRoomInput extends WithAuth {
  body: {
    playerName: string;
    displayName?: string;
    config: GameConfig;
    allowAiFill: boolean;
    visibility: 'public' | 'private';
  };
}

export async function createRoom(input: CreateRoomInput): Promise<{ roomId: string; code: string }> {
  const res = await fetch(`${input.baseUrl}/v1/rooms`, {
    method: 'POST',
    headers: authHeaders(input.sessionId),
    body: JSON.stringify(input.body),
  });
  return parseResponse(res);
}

export interface JoinRoomInput extends WithAuth {
  roomId: string;
  playerName: string;
}

export async function joinRoom(input: JoinRoomInput): Promise<{ room: RoomInfo; slotIndex: number }> {
  const res = await fetch(`${input.baseUrl}/v1/rooms/${encodeURIComponent(input.roomId)}/members`, {
    method: 'POST',
    headers: authHeaders(input.sessionId),
    body: JSON.stringify({ playerName: input.playerName }),
  });
  return parseResponse(res);
}

export interface LeaveRoomInput extends WithAuth {
  roomId: string;
  targetSessionId: string;
}

export async function leaveRoom(input: LeaveRoomInput): Promise<void> {
  const res = await fetch(
    `${input.baseUrl}/v1/rooms/${encodeURIComponent(input.roomId)}/members/${encodeURIComponent(input.targetSessionId)}`,
    { method: 'DELETE', headers: authHeaders(input.sessionId) },
  );
  if (!res.ok && res.status !== 204) await parseResponse(res);
}

export interface SetSlotInput extends WithAuth {
  roomId: string;
  index: number;
  desired: { kind: 'open' | 'locked' } | { kind: 'ai'; difficulty: 'easy' };
}

export async function setSlot(input: SetSlotInput): Promise<void> {
  const res = await fetch(
    `${input.baseUrl}/v1/rooms/${encodeURIComponent(input.roomId)}/slots/${input.index}`,
    {
      method: 'PUT',
      headers: authHeaders(input.sessionId),
      body: JSON.stringify(input.desired),
    },
  );
  if (!res.ok && res.status !== 204) await parseResponse(res);
}

export interface PatchRoomInput extends WithAuth {
  roomId: string;
  patch: Partial<{ displayName: string; config: GameConfig; allowAiFill: boolean; visibility: 'public' | 'private' }>;
}

export async function patchRoom(input: PatchRoomInput): Promise<void> {
  const res = await fetch(
    `${input.baseUrl}/v1/rooms/${encodeURIComponent(input.roomId)}`,
    {
      method: 'PATCH',
      headers: { ...authHeaders(input.sessionId), 'content-type': 'application/merge-patch+json' },
      body: JSON.stringify(input.patch),
    },
  );
  if (!res.ok && res.status !== 204) await parseResponse(res);
}

export interface StartGameInput extends WithAuth {
  roomId: string;
}

export async function startGame(input: StartGameInput): Promise<{ startedAt: number }> {
  const res = await fetch(
    `${input.baseUrl}/v1/rooms/${encodeURIComponent(input.roomId)}/game`,
    { method: 'POST', headers: authHeaders(input.sessionId) },
  );
  return parseResponse(res);
}

export interface FindRoomByCodeInput {
  baseUrl: string;
  code: string;
}

export async function findRoomByCode(input: FindRoomByCodeInput): Promise<RoomInfo | null> {
  const res = await fetch(
    `${input.baseUrl}/v1/rooms?code=${encodeURIComponent(input.code)}`,
    { method: 'GET' },
  );
  const body = await parseResponse<{ rooms: RoomInfo[] }>(res);
  return body.rooms[0] ?? null;
}
```

You'll need to add `RoomInfo` to the client-side protocol types. Check if it already exists in `src/lib/net/protocol.ts`; if not, add it there:

```typescript
export interface RoomInfo {
  id: string;
  code: string | null;
  displayName: string;
  phase: 'waiting' | 'playing' | 'finished';
  config: import('@/lib/game/types').GameConfig;
  allowAiFill: boolean;
  visibility: 'public' | 'private';
  slotSummary: { humans: number; ai: number; open: number; locked: number; capacity: number };
  hostName: string;
  createdAt: number;
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- api.test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/net/api.ts src/lib/net/api.test.ts src/lib/net/protocol.ts
git commit -m "Add typed REST wrappers with Problem+JSON error parsing"
```

---

### Task 8: useLobbyStream hook

**Depends on:** Task 0, Task 7 (for `RoomInfo` type).
**Parallel with:** Tasks 1-6, 9.

**Files:**
- Create: `src/lib/net/useLobbyStream.ts`
- Create: `src/lib/net/useLobbyStream.test.tsx`

- [ ] **Step 1: Sketch the interface**

The hook returns:

```typescript
interface LobbyStream {
  rooms: RoomInfo[];
  stats: { gamesInProgress: number; playersOnline: number };
  connected: boolean;
}
```

Consumes SSE events:
- `snapshot` → replace rooms + stats
- `roomAdded` / `roomUpdated` → upsert by id
- `roomRemoved` → delete by id
- `statsUpdate` → replace stats

- [ ] **Step 2: Write failing test**

Create `src/lib/net/useLobbyStream.test.tsx`:

```typescript
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLobbyStream } from './useLobbyStream';

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  readyState = 0;
  private listeners = new Map<string, Array<(e: MessageEvent) => void>>();
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(fn);
  }
  removeEventListener(type: string, fn: (e: MessageEvent) => void) {
    const arr = this.listeners.get(type);
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }
  close() { this.readyState = 2; }
  fire(type: string, data: unknown, lastEventId = '') {
    const ev = new MessageEvent(type, { data: JSON.stringify(data), lastEventId });
    (this.listeners.get(type) ?? []).forEach((fn) => fn(ev));
  }
  openConnection() {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }
}

beforeEach(() => {
  vi.stubGlobal('EventSource', MockEventSource);
  MockEventSource.instances.length = 0;
});

describe('useLobbyStream', () => {
  it('hydrates from snapshot event', () => {
    const { result } = renderHook(() => useLobbyStream({
      baseUrl: 'http://localhost:8787',
      sessionId: 's-1',
    }));
    const es = MockEventSource.instances[0]!;
    act(() => {
      es.openConnection();
      es.fire('snapshot', {
        type: 'snapshot',
        rooms: [{ id: 'r1', code: null, displayName: 'Table', phase: 'waiting', hostName: 'Alice', createdAt: 0, allowAiFill: false, visibility: 'public', slotSummary: { humans: 1, ai: 0, open: 1, locked: 0, capacity: 2 }, config: {} as any }],
        stats: { gamesInProgress: 0, playersOnline: 1 },
      });
    });
    expect(result.current.rooms).toHaveLength(1);
    expect(result.current.stats.playersOnline).toBe(1);
    expect(result.current.connected).toBe(true);
  });

  it('upserts on roomAdded and deletes on roomRemoved', () => {
    const { result } = renderHook(() => useLobbyStream({
      baseUrl: 'http://localhost:8787',
      sessionId: 's-1',
    }));
    const es = MockEventSource.instances[0]!;
    act(() => {
      es.openConnection();
      es.fire('snapshot', { type: 'snapshot', rooms: [], stats: { gamesInProgress: 0, playersOnline: 0 } });
      es.fire('roomAdded', { type: 'roomAdded', room: { id: 'r2', code: null, displayName: 'New', phase: 'waiting', hostName: 'Bob', createdAt: 0, allowAiFill: false, visibility: 'public', slotSummary: { humans: 1, ai: 0, open: 1, locked: 0, capacity: 2 }, config: {} as any } });
    });
    expect(result.current.rooms.map((r) => r.id)).toEqual(['r2']);
    act(() => {
      es.fire('roomRemoved', { type: 'roomRemoved', roomId: 'r2' });
    });
    expect(result.current.rooms).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
npm test -- useLobbyStream
```

Expected: FAIL — module missing.

- [ ] **Step 4: Implement the hook**

Create `src/lib/net/useLobbyStream.ts`:

```typescript
'use client';

import { useEffect, useState } from 'react';
import type { RoomInfo } from './protocol';

export interface LobbyStats {
  gamesInProgress: number;
  playersOnline: number;
}

export interface UseLobbyStreamArgs {
  baseUrl: string;
  sessionId: string | null;
}

export interface LobbyStream {
  rooms: RoomInfo[];
  stats: LobbyStats;
  connected: boolean;
}

export function useLobbyStream(args: UseLobbyStreamArgs): LobbyStream {
  const [rooms, setRooms] = useState<Map<string, RoomInfo>>(new Map());
  const [stats, setStats] = useState<LobbyStats>({ gamesInProgress: 0, playersOnline: 0 });
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!args.sessionId) return;
    const url = `${args.baseUrl}/v1/lobby/stream?sessionId=${encodeURIComponent(args.sessionId)}`;
    const es = new EventSource(url);

    const onSnapshot = (ev: MessageEvent) => {
      const data = JSON.parse(ev.data) as { type: 'snapshot'; rooms: RoomInfo[]; stats: LobbyStats };
      setRooms(new Map(data.rooms.map((r) => [r.id, r])));
      setStats(data.stats);
    };
    const onAdded = (ev: MessageEvent) => {
      const data = JSON.parse(ev.data) as { type: 'roomAdded'; room: RoomInfo };
      setRooms((prev) => new Map(prev).set(data.room.id, data.room));
    };
    const onUpdated = (ev: MessageEvent) => {
      const data = JSON.parse(ev.data) as { type: 'roomUpdated'; room: RoomInfo };
      setRooms((prev) => new Map(prev).set(data.room.id, data.room));
    };
    const onRemoved = (ev: MessageEvent) => {
      const data = JSON.parse(ev.data) as { type: 'roomRemoved'; roomId: string };
      setRooms((prev) => { const next = new Map(prev); next.delete(data.roomId); return next; });
    };
    const onStats = (ev: MessageEvent) => {
      const data = JSON.parse(ev.data) as { type: 'statsUpdate'; stats: LobbyStats };
      setStats(data.stats);
    };

    es.addEventListener('snapshot', onSnapshot);
    es.addEventListener('roomAdded', onAdded);
    es.addEventListener('roomUpdated', onUpdated);
    es.addEventListener('roomRemoved', onRemoved);
    es.addEventListener('statsUpdate', onStats);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    return () => {
      es.removeEventListener('snapshot', onSnapshot);
      es.removeEventListener('roomAdded', onAdded);
      es.removeEventListener('roomUpdated', onUpdated);
      es.removeEventListener('roomRemoved', onRemoved);
      es.removeEventListener('statsUpdate', onStats);
      es.close();
    };
  }, [args.baseUrl, args.sessionId]);

  return {
    rooms: [...rooms.values()].sort((a, b) => b.createdAt - a.createdAt),
    stats,
    connected,
  };
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- useLobbyStream
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/net/useLobbyStream.ts src/lib/net/useLobbyStream.test.tsx
git commit -m "Add useLobbyStream hook over the lobby SSE feed"
```

---

### Task 9: NewGameModal edit mode

**Depends on:** Task 0.
**Parallel with:** Tasks 1-8.

**Files:**
- Modify: `src/components/NewGameModal.tsx`
- Create: `src/components/NewGameModal.edit.test.tsx` (or extend an existing test file for NewGameModal if one exists — `grep -l 'NewGameModal' src/**/*.test.*`)

- [ ] **Step 1: Read the existing NewGameModal**

```bash
cat src/components/NewGameModal.tsx | head -80
```

Note the `NewGameSettings` shape and the existing props.

- [ ] **Step 2: Write failing test for edit mode**

Create `src/components/NewGameModal.edit.test.tsx`:

```typescript
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import NewGameModal from './NewGameModal';
import type { NewGameSettings } from './NewGameModal';

describe('NewGameModal edit mode', () => {
  it('locks player count when editMode is true', () => {
    const initial: NewGameSettings = { /* fill in from existing type */ } as NewGameSettings;
    render(
      <NewGameModal
        open={true}
        onCancel={() => {}}
        onStart={() => {}}
        defaultPlayerCount={3}
        initial={initial}
        editMode
      />,
    );
    // Player count input should be disabled or absent.
    const input = screen.queryByLabelText(/player count/i);
    if (input) expect(input).toBeDisabled();
  });

  it('passes initial settings to the form and prefills', () => {
    const onStart = vi.fn();
    const initial: NewGameSettings = {
      playerCount: 3, ruleset: 'official', stockPileSize: 30, handSize: 5, bidirectionalBuild: true, partnership: false,
    } as NewGameSettings;
    render(<NewGameModal open={true} onCancel={() => {}} onStart={onStart} defaultPlayerCount={3} initial={initial} />);
    // Poke whatever "Start" button exists — verify onStart receives initial settings.
    const startBtn = screen.getByRole('button', { name: /start/i });
    fireEvent.click(startBtn);
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ ruleset: 'official', stockPileSize: 30 }));
  });
});
```

Copy the actual `NewGameSettings` shape from the current type — the placeholder above is just a skeleton.

- [ ] **Step 3: Run to verify failure**

```bash
npm test -- NewGameModal.edit
```

Expected: FAIL.

- [ ] **Step 4: Add `initial` and `editMode` props**

Modify `src/components/NewGameModal.tsx`:

Add to the props interface:

```typescript
initial?: NewGameSettings;
editMode?: boolean;
```

In the component body, use `initial` as the starting state of the form (replace the current defaults with `initial ?? <existing defaults>`). When `editMode === true`:
- Disable the player count input (`<input type="number" ... disabled={editMode} />` or equivalent).
- Disable partnership team-shape controls (team picker), keep the `partnership` toggle + permission flags editable.

- [ ] **Step 5: Run tests**

```bash
npm test -- NewGameModal
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/NewGameModal.tsx src/components/NewGameModal.edit.test.tsx
git commit -m "Add initial and editMode props to NewGameModal for room config edits"
```

---

## Phase 3 — Small components (all parallel)

### Task 10: StatsChip component

**Depends on:** Task 8 (useLobbyStream).
**Parallel with:** Tasks 11-18.

**Files:**
- Create: `src/components/lobby/StatsChip.tsx`
- Create: `src/components/lobby/StatsChip.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatsChip } from './StatsChip';

describe('StatsChip', () => {
  it('renders games and players', () => {
    render(<StatsChip stats={{ gamesInProgress: 3, playersOnline: 12 }} connected={true} />);
    expect(screen.getByText(/3 games · 12 online/i)).toBeInTheDocument();
  });

  it('shows reconnecting dot when disconnected', () => {
    render(<StatsChip stats={{ gamesInProgress: 0, playersOnline: 0 }} connected={false} />);
    expect(screen.getByLabelText(/reconnecting/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement**

Create `src/components/lobby/StatsChip.tsx`:

```typescript
'use client';

import type { LobbyStats } from '@/lib/net/useLobbyStream';

export interface StatsChipProps {
  stats: LobbyStats;
  connected: boolean;
}

export function StatsChip({ stats, connected }: StatsChipProps) {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-xs text-white/80"
      style={{ background: 'rgba(0,0,0,0.45)' }}
    >
      {!connected && (
        <span
          aria-label="reconnecting"
          className="w-2 h-2 rounded-full bg-amber-300 animate-pulse"
        />
      )}
      <span>{stats.gamesInProgress} games · {stats.playersOnline} online</span>
    </div>
  );
}
```

- [ ] **Step 3: Run tests + commit**

```bash
npm test -- StatsChip
git add src/components/lobby/StatsChip.tsx src/components/lobby/StatsChip.test.tsx
git commit -m "Add StatsChip component rendering lobby game counts"
```

---

### Task 11: RoomCard component

**Depends on:** Task 7 (RoomInfo type).
**Parallel with:** Tasks 10, 12-18.

**Files:**
- Create: `src/components/lobby/RoomCard.tsx`
- Create: `src/components/lobby/RoomCard.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoomCard } from './RoomCard';
import type { RoomInfo } from '@/lib/net/protocol';

function mkRoom(overrides: Partial<RoomInfo> = {}): RoomInfo {
  return {
    id: 'r-1',
    code: null,
    displayName: "Alice's table",
    phase: 'waiting',
    hostName: 'Alice',
    allowAiFill: false,
    visibility: 'public',
    slotSummary: { humans: 1, ai: 0, open: 1, locked: 0, capacity: 2 },
    config: { ruleset: 'recommended', stockPileSize: 10, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null },
    createdAt: 0,
    ...overrides,
  };
}

describe('RoomCard', () => {
  it('renders display name, host, slot counts, ruleset', () => {
    render(<RoomCard room={mkRoom()} onJoin={() => {}} />);
    expect(screen.getByText(/Alice's table/)).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText(/1\/2/)).toBeInTheDocument();
    expect(screen.getByText(/recommended/i)).toBeInTheDocument();
  });

  it('disables Join when full and AI fill off', () => {
    const room = mkRoom({ slotSummary: { humans: 2, ai: 0, open: 0, locked: 0, capacity: 2 } });
    render(<RoomCard room={room} onJoin={() => {}} />);
    expect(screen.getByRole('button', { name: /join/i })).toBeDisabled();
  });

  it('fires onJoin with room id', () => {
    const spy = vi.fn();
    render(<RoomCard room={mkRoom()} onJoin={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /join/i }));
    expect(spy).toHaveBeenCalledWith('r-1');
  });
});
```

- [ ] **Step 2: Implement**

Create `src/components/lobby/RoomCard.tsx`:

```typescript
'use client';

import type { RoomInfo } from '@/lib/net/protocol';

export interface RoomCardProps {
  room: RoomInfo;
  onJoin: (roomId: string) => void;
}

export function RoomCard({ room, onJoin }: RoomCardProps) {
  const { humans, ai, open, capacity } = room.slotSummary;
  const joinDisabled = open === 0 && !room.allowAiFill;

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-white truncate">{room.displayName}</div>
        <div className="text-xs text-white/60">
          host <span className="text-white/80">{room.hostName}</span> · {humans}/{capacity}
          {ai > 0 && <> +{ai} AI</>} · <span className="uppercase tracking-wider">{room.config.ruleset}</span>
          {room.config.partnership?.enabled && <> · partnership</>}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onJoin(room.id)}
        disabled={joinDisabled}
        className="bg-[var(--gold)] text-stone-900 font-semibold hover:brightness-110 px-3 py-1 rounded text-xs disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Join
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Run + commit**

```bash
npm test -- RoomCard
git add src/components/lobby/RoomCard.tsx src/components/lobby/RoomCard.test.tsx
git commit -m "Add RoomCard rendering room summary with disabled Join when full"
```

---

### Task 12: CreateRoomForm component

**Depends on:** Task 7 (api.ts), Task 9 (NewGameModal edit mode).
**Parallel with:** Tasks 10, 11, 13-18.

**Files:**
- Create: `src/components/lobby/CreateRoomForm.tsx`
- Create: `src/components/lobby/CreateRoomForm.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateRoomForm } from './CreateRoomForm';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('CreateRoomForm', () => {
  it('POSTs to /v1/rooms and calls onCreated with the new room id', async () => {
    fetchMock.mockResolvedValue(new Response(
      JSON.stringify({ roomId: 'r-new', code: 'GOLD-42' }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    ));
    const spy = vi.fn();
    render(
      <CreateRoomForm
        baseUrl="http://localhost:8787"
        sessionId="s-1"
        playerName="Alice"
        onCreated={spy}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /open settings/i }));
    // The settings modal mounts; click its Start button.
    fireEvent.click(await screen.findByRole('button', { name: /create room/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('r-new'));
  });
});
```

- [ ] **Step 2: Implement**

Create `src/components/lobby/CreateRoomForm.tsx`:

```typescript
'use client';

import { useState } from 'react';
import NewGameModal, { NewGameSettings, buildPartnershipFromSettings, settingsToConfigOverrides } from '@/components/NewGameModal';
import { createRoom, ApiError } from '@/lib/net/api';

export interface CreateRoomFormProps {
  baseUrl: string;
  sessionId: string;
  playerName: string;
  onCreated: (roomId: string) => void;
}

export function CreateRoomForm({ baseUrl, sessionId, playerName, onCreated }: CreateRoomFormProps) {
  const [open, setOpen] = useState(false);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [allowAiFill, setAllowAiFill] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleStart = async (settings: NewGameSettings) => {
    setBusy(true);
    setError(null);
    try {
      const players = Array.from({ length: settings.playerCount }, (_, i) => `p${i + 1}`);
      const { roomId } = await createRoom({
        baseUrl,
        sessionId,
        body: {
          playerName,
          config: {
            ruleset: settings.ruleset,
            ...settingsToConfigOverrides(settings),
            maxPlayers: settings.playerCount,
            partnership: buildPartnershipFromSettings(settings, players),
          } as any,
          allowAiFill,
          visibility,
        },
      });
      setOpen(false);
      onCreated(roomId);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.title) : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-white/90 uppercase tracking-wider">Create room</h2>
      <div className="flex gap-4 text-xs text-white/70">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={visibility === 'public'}
            onChange={() => setVisibility('public')}
          />
          Public
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={visibility === 'private'}
            onChange={() => setVisibility('private')}
          />
          Private (invite code only)
        </label>
      </div>
      <label className="flex items-center gap-2 text-xs text-white/70">
        <input type="checkbox" checked={allowAiFill} onChange={(e) => setAllowAiFill(e.target.checked)} />
        Allow AI fill when game starts
      </label>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={busy}
        className="bg-[var(--gold)] text-stone-900 font-semibold hover:brightness-110 px-3 py-1 rounded text-xs disabled:opacity-50"
      >
        {busy ? 'Creating…' : 'Open settings'}
      </button>
      {error && <div className="text-xs text-rose-300">{error}</div>}
      <NewGameModal
        open={open}
        onCancel={() => setOpen(false)}
        onStart={handleStart}
        defaultPlayerCount={2}
      />
    </div>
  );
}
```

Note: the NewGameModal's submit button today says "Start Game"; for this use, its label is the same but semantically creates a room. If the modal needs a label override prop, add it in Task 9 follow-up; otherwise keep the existing label and adjust the test's selector to match.

- [ ] **Step 3: Run + commit**

```bash
npm test -- CreateRoomForm
git add src/components/lobby/CreateRoomForm.tsx src/components/lobby/CreateRoomForm.test.tsx
git commit -m "Add CreateRoomForm wrapping NewGameModal with visibility toggle"
```

---

### Task 13: JoinByCodeForm component

**Depends on:** Task 5 (shared normalizeRoomCode), Task 7 (api.ts).
**Parallel with:** Tasks 10-12, 14-18.

**Files:**
- Create: `src/components/lobby/JoinByCodeForm.tsx`
- Create: `src/components/lobby/JoinByCodeForm.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { JoinByCodeForm } from './JoinByCodeForm';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('JoinByCodeForm', () => {
  it('finds room by code, joins, calls onJoined', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ rooms: [{ id: 'r-9', code: 'GOLD-42' }], stats: {} }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ slotIndex: 1, room: { id: 'r-9' } }), { status: 201, headers: { 'content-type': 'application/json' } }));
    const spy = vi.fn();
    render(<JoinByCodeForm baseUrl="http://localhost:8787" sessionId="s-1" playerName="Alice" onJoined={spy} />);
    fireEvent.change(screen.getByLabelText(/code/i), { target: { value: 'gold-42  ' } });
    fireEvent.click(screen.getByRole('button', { name: /join/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('r-9'));
    expect(fetchMock.mock.calls[0][0]).toContain('code=GOLD-42');
  });

  it('surfaces 404 from findRoomByCode as "No room with that code"', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ rooms: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    render(<JoinByCodeForm baseUrl="http://localhost:8787" sessionId="s-1" playerName="Alice" onJoined={() => {}} />);
    fireEvent.change(screen.getByLabelText(/code/i), { target: { value: 'bogus' } });
    fireEvent.click(screen.getByRole('button', { name: /join/i }));
    expect(await screen.findByText(/no room with that code/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement**

Create `src/components/lobby/JoinByCodeForm.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { findRoomByCode, joinRoom, ApiError } from '@/lib/net/api';
import { normalizeRoomCode } from '@/lib/room/code';

export interface JoinByCodeFormProps {
  baseUrl: string;
  sessionId: string;
  playerName: string;
  onJoined: (roomId: string) => void;
}

export function JoinByCodeForm({ baseUrl, sessionId, playerName, onJoined }: JoinByCodeFormProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeRoomCode(code);
    if (!normalized) return;
    setBusy(true);
    setError(null);
    try {
      const room = await findRoomByCode({ baseUrl, code: normalized });
      if (!room) {
        setError('No room with that code');
        return;
      }
      await joinRoom({ baseUrl, sessionId, roomId: room.id, playerName });
      onJoined(room.id);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.title) : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <h2 className="text-sm font-semibold text-white/90 uppercase tracking-wider">Join by code</h2>
      <label className="block text-xs text-white/70">
        Code
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="mt-1 block w-full bg-black/40 border border-white/15 rounded px-2 py-1 text-sm text-white"
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="bg-[var(--gold)] text-stone-900 font-semibold hover:brightness-110 px-3 py-1 rounded text-xs disabled:opacity-50"
      >
        {busy ? 'Joining…' : 'Join'}
      </button>
      {error && <div className="text-xs text-rose-300">{error}</div>}
    </form>
  );
}
```

- [ ] **Step 3: Run + commit**

```bash
npm test -- JoinByCodeForm
git add src/components/lobby/JoinByCodeForm.tsx src/components/lobby/JoinByCodeForm.test.tsx
git commit -m "Add JoinByCodeForm resolving code to room then joining"
```

---

### Task 14: DisplayNameEditor component

**Depends on:** Task 6 (useDisplayName).
**Parallel with:** Tasks 10-13, 15-18.

**Files:**
- Create: `src/components/lobby/DisplayNameEditor.tsx`
- Create: `src/components/lobby/DisplayNameEditor.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DisplayNameEditor } from './DisplayNameEditor';

describe('DisplayNameEditor', () => {
  it('renders current name and calls onChange with the new value', () => {
    const spy = vi.fn();
    render(<DisplayNameEditor name="Alice" onChange={spy} />);
    fireEvent.click(screen.getByText('Alice'));
    const input = screen.getByDisplayValue('Alice');
    fireEvent.change(input, { target: { value: 'Bob' } });
    fireEvent.blur(input);
    expect(spy).toHaveBeenCalledWith('Bob');
  });
});
```

- [ ] **Step 2: Implement**

```typescript
'use client';

import { useState, useRef, useEffect } from 'react';

export interface DisplayNameEditorProps {
  name: string;
  onChange: (next: string) => void;
}

export function DisplayNameEditor({ name, onChange }: DisplayNameEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  useEffect(() => { setDraft(name); }, [name]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) onChange(trimmed);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className="bg-black/40 border border-white/15 rounded px-2 py-1 text-xs text-white"
        title="Your name for the next room"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="text-xs text-white/80 underline decoration-dotted hover:text-white"
      title="Your name for the next room"
    >
      {name}
    </button>
  );
}
```

- [ ] **Step 3: Run + commit**

```bash
npm test -- DisplayNameEditor
git add src/components/lobby/DisplayNameEditor.tsx src/components/lobby/DisplayNameEditor.test.tsx
git commit -m "Add DisplayNameEditor popover for the lobby header"
```

---

### Task 15: SlotList component

**Depends on:** Task 1 (protocol), Task 7 (api.ts).
**Parallel with:** Tasks 10-14, 16-18.

**Files:**
- Create: `src/components/room/SlotList.tsx`
- Create: `src/components/room/SlotList.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SlotList } from './SlotList';
import type { GameViewSeat } from '@/lib/net/protocol';

const seats: GameViewSeat[] = [
  { slotIndex: 0, kind: 'human', name: 'Alice', connected: true, graceDeadline: null, botControlled: false, isHost: true },
  { slotIndex: 1, kind: 'open', name: null, connected: false, graceDeadline: null, botControlled: false, isHost: false },
  { slotIndex: 2, kind: 'ai', name: null, connected: false, graceDeadline: null, botControlled: false, isHost: false },
];

describe('SlotList', () => {
  it('host sees slot-kind dropdown on every seat except own', () => {
    render(<SlotList seats={seats} youSlotIndex={0} isHost={true} onSetSlot={() => {}} />);
    const dropdowns = screen.getAllByRole('combobox');
    expect(dropdowns).toHaveLength(2); // slots 1 and 2, not slot 0
  });

  it('non-host sees seats read-only', () => {
    render(<SlotList seats={seats} youSlotIndex={1} isHost={false} onSetSlot={() => {}} />);
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('fires onSetSlot when host changes a slot', () => {
    const spy = vi.fn();
    render(<SlotList seats={seats} youSlotIndex={0} isHost={true} onSetSlot={spy} />);
    const first = screen.getAllByRole('combobox')[0]!;
    fireEvent.change(first, { target: { value: 'locked' } });
    expect(spy).toHaveBeenCalledWith(1, { kind: 'locked' });
  });
});
```

- [ ] **Step 2: Implement**

```typescript
'use client';

import type { GameViewSeat } from '@/lib/net/protocol';

type SlotDesired = { kind: 'open' | 'locked' } | { kind: 'ai'; difficulty: 'easy' };

export interface SlotListProps {
  seats: GameViewSeat[];
  youSlotIndex: number;
  isHost: boolean;
  onSetSlot: (index: number, desired: SlotDesired) => void;
}

export function SlotList({ seats, youSlotIndex, isHost, onSetSlot }: SlotListProps) {
  return (
    <ul className="space-y-2">
      {seats.map((seat) => {
        const canEdit = isHost && seat.slotIndex !== youSlotIndex;
        return (
          <li
            key={seat.slotIndex}
            className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2"
          >
            <span className="text-[10px] uppercase tracking-widest text-white/50 w-8">
              #{seat.slotIndex + 1}
            </span>
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <span className="text-sm text-white truncate">{labelFor(seat)}</span>
              {seat.isHost && (
                <span className="text-[10px] uppercase tracking-wider text-[var(--gold)] font-bold">host</span>
              )}
              {seat.kind === 'human' && (
                <ConnectionDot connected={seat.connected} graceDeadline={seat.graceDeadline} botControlled={seat.botControlled} />
              )}
            </div>
            {canEdit && (
              <select
                className="bg-black/40 border border-white/15 rounded px-2 py-1 text-xs text-white"
                value={seat.kind}
                onChange={(e) => {
                  const v = e.target.value as 'open' | 'locked' | 'ai';
                  onSetSlot(seat.slotIndex, v === 'ai' ? { kind: 'ai', difficulty: 'easy' } : { kind: v });
                }}
              >
                <option value="human" disabled>Human (joined)</option>
                <option value="open">Open</option>
                <option value="locked">Locked</option>
                <option value="ai">AI</option>
              </select>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function labelFor(seat: GameViewSeat): string {
  if (seat.kind === 'human') return seat.name ?? 'Player';
  if (seat.kind === 'ai') return 'AI';
  if (seat.kind === 'locked') return 'Locked';
  return 'Empty';
}

function ConnectionDot({ connected, graceDeadline, botControlled }: { connected: boolean; graceDeadline: number | null; botControlled: boolean }) {
  if (botControlled) return <span className="text-[10px] text-orange-300">bot takeover</span>;
  if (!connected && graceDeadline !== null) return <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" aria-label="disconnected, grace running" />;
  if (!connected) return <span className="w-2 h-2 rounded-full bg-rose-500" aria-label="disconnected" />;
  return <span className="w-2 h-2 rounded-full bg-emerald-400" aria-label="connected" />;
}
```

- [ ] **Step 3: Run + commit**

```bash
npm test -- SlotList
git add src/components/room/SlotList.tsx src/components/room/SlotList.test.tsx
git commit -m "Add SlotList rendering seat rows with host slot-kind dropdown"
```

---

### Task 16: ConfigSummary component

**Depends on:** Task 9 (NewGameModal edit mode).
**Parallel with:** Tasks 10-15, 17-18.

**Files:**
- Create: `src/components/room/ConfigSummary.tsx`
- Create: `src/components/room/ConfigSummary.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfigSummary } from './ConfigSummary';

describe('ConfigSummary', () => {
  const config = { ruleset: 'recommended', stockPileSize: 20, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null } as any;

  it('renders readable key/value list', () => {
    render(<ConfigSummary config={config} isHost={false} onEdit={() => {}} />);
    expect(screen.getByText(/recommended/i)).toBeInTheDocument();
    expect(screen.getByText(/20/)).toBeInTheDocument();
  });

  it('shows Edit button only to host', () => {
    const spy = vi.fn();
    const { rerender } = render(<ConfigSummary config={config} isHost={false} onEdit={spy} />);
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
    rerender(<ConfigSummary config={config} isHost={true} onEdit={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(spy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement**

```typescript
'use client';

import type { PublicGameConfig } from '@/lib/net/protocol';

export interface ConfigSummaryProps {
  config: PublicGameConfig;
  isHost: boolean;
  onEdit: () => void;
}

export function ConfigSummary({ config, isHost, onEdit }: ConfigSummaryProps) {
  const items: Array<[string, string]> = [
    ['Ruleset', config.ruleset],
    ['Stock size', String(config.stockPileSize)],
    ['Hand size', String(config.handSize)],
    ['Bidirectional build', config.bidirectionalBuild ? 'on' : 'off'],
    ['Max players', String(config.maxPlayers)],
    ['Partnership', config.partnership?.enabled ? 'on' : 'off'],
  ];

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wider text-white/70 font-semibold">Configuration</h3>
        {isHost && (
          <button
            type="button"
            onClick={onEdit}
            className="text-xs text-[var(--gold)] underline decoration-dotted hover:brightness-110"
          >
            Edit
          </button>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-y-1 text-xs text-white/80">
        {items.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-white/50">{label}</dt>
            <dd className="text-right">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
```

- [ ] **Step 3: Run + commit**

```bash
npm test -- ConfigSummary
git add src/components/room/ConfigSummary.tsx src/components/room/ConfigSummary.test.tsx
git commit -m "Add ConfigSummary key/value panel with host-only Edit button"
```

---

### Task 17: ChatPanel component

**Depends on:** Task 0 (useGameSocket already exposes chat + sendChat).
**Parallel with:** Tasks 10-16, 18.

**Files:**
- Create: `src/components/room/ChatPanel.tsx`
- Create: `src/components/room/ChatPanel.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatPanel } from './ChatPanel';

describe('ChatPanel', () => {
  it('renders messages in order', () => {
    render(
      <ChatPanel
        chat={[
          { fromSlotIndex: 0, fromName: 'Alice', text: 'hi', sentAt: 1 },
          { fromSlotIndex: 1, fromName: 'Bob', text: 'hey', sentAt: 2 },
        ]}
        onSend={() => {}}
      />,
    );
    expect(screen.getByText('hi')).toBeInTheDocument();
    expect(screen.getByText('hey')).toBeInTheDocument();
  });

  it('submits non-empty input and clears the field', () => {
    const spy = vi.fn();
    render(<ChatPanel chat={[]} onSend={spy} />);
    const input = screen.getByPlaceholderText(/type a message/i);
    fireEvent.change(input, { target: { value: '  hello  ' } });
    fireEvent.submit(input.closest('form')!);
    expect(spy).toHaveBeenCalledWith('hello');
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('ignores empty submits', () => {
    const spy = vi.fn();
    render(<ChatPanel chat={[]} onSend={spy} />);
    const form = screen.getByPlaceholderText(/type a message/i).closest('form')!;
    fireEvent.submit(form);
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement**

```typescript
'use client';

import { useState } from 'react';
import type { ChatEntry } from '@/lib/net/protocol';

export interface ChatPanelProps {
  chat: ChatEntry[];
  onSend: (text: string) => void;
}

export function ChatPanel({ chat, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setDraft('');
  };

  return (
    <div className="flex flex-col h-60 rounded-xl border border-white/10 bg-black/30">
      <ol className="flex-1 overflow-y-auto px-3 py-2 space-y-1 text-xs text-white/85">
        {chat.map((c, i) => (
          <li key={i}>
            <span className="text-white/50">{c.fromName}:</span> {c.text}
          </li>
        ))}
        {chat.length === 0 && <li className="text-white/40 italic">No messages yet</li>}
      </ol>
      <form onSubmit={submit} className="border-t border-white/10 p-2 flex gap-2">
        <input
          type="text"
          placeholder="Type a message…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="flex-1 bg-black/40 border border-white/15 rounded px-2 py-1 text-xs text-white"
          maxLength={200}
        />
        <button type="submit" className="bg-[var(--gold)] text-stone-900 font-semibold hover:brightness-110 px-2 py-1 rounded text-xs">
          Send
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Run + commit**

```bash
npm test -- ChatPanel
git add src/components/room/ChatPanel.tsx src/components/room/ChatPanel.test.tsx
git commit -m "Add ChatPanel with scrolling log and bounded input"
```

---

### Task 18: StartButton component

**Depends on:** Task 7 (api.ts).
**Parallel with:** Tasks 10-17.

**Files:**
- Create: `src/components/room/StartButton.tsx`
- Create: `src/components/room/StartButton.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StartButton, canStart } from './StartButton';

describe('canStart', () => {
  it('allows start when full human table', () => {
    expect(canStart({ humans: 2, ai: 0, open: 0, locked: 0, capacity: 2 }, false)).toBe(true);
  });
  it('allows start when allowAiFill and at least one human', () => {
    expect(canStart({ humans: 1, ai: 0, open: 1, locked: 0, capacity: 2 }, true)).toBe(true);
  });
  it('rejects when under 2 total seated', () => {
    expect(canStart({ humans: 1, ai: 0, open: 0, locked: 1, capacity: 2 }, true)).toBe(false);
  });
  it('rejects when open slots and no AI fill', () => {
    expect(canStart({ humans: 1, ai: 0, open: 1, locked: 0, capacity: 2 }, false)).toBe(false);
  });
});

describe('StartButton', () => {
  it('disables with tooltip when canStart false', () => {
    render(
      <StartButton
        slotSummary={{ humans: 1, ai: 0, open: 1, locked: 0, capacity: 2 }}
        allowAiFill={false}
        busy={false}
        onClick={() => {}}
      />,
    );
    const btn = screen.getByRole('button', { name: /start/i });
    expect(btn).toBeDisabled();
  });
});
```

- [ ] **Step 2: Implement**

```typescript
'use client';

import type { RoomInfo } from '@/lib/net/protocol';

type SlotSummary = RoomInfo['slotSummary'];

export function canStart(summary: SlotSummary, allowAiFill: boolean): boolean {
  const { humans, open } = summary;
  if (humans >= 2 && open === 0) return true;
  if (allowAiFill && humans >= 1 && humans + open >= 2) return true;
  return false;
}

export interface StartButtonProps {
  slotSummary: SlotSummary;
  allowAiFill: boolean;
  busy: boolean;
  onClick: () => void;
}

export function StartButton({ slotSummary, allowAiFill, busy, onClick }: StartButtonProps) {
  const enabled = canStart(slotSummary, allowAiFill) && !busy;
  const tooltip = enabled
    ? 'Start the game'
    : slotSummary.humans < 2 && !allowAiFill
      ? 'Need at least two human players'
      : slotSummary.open > 0
        ? 'Fill or lock open slots first'
        : 'Not enough players';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      title={tooltip}
      className="bg-[var(--gold)] text-stone-900 font-semibold hover:brightness-110 px-4 py-2 rounded text-sm disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {busy ? 'Starting…' : 'Start game'}
    </button>
  );
}
```

- [ ] **Step 3: Run + commit**

```bash
npm test -- StartButton
git add src/components/room/StartButton.tsx src/components/room/StartButton.test.tsx
git commit -m "Add StartButton with client-side guard matching server preconditions"
```

---

## Phase 4 — Assembly (serial)

### Task 19: RoomList component

**Depends on:** Task 8 (useLobbyStream), Task 11 (RoomCard).

**Files:**
- Create: `src/components/lobby/RoomList.tsx`
- Create: `src/components/lobby/RoomList.test.tsx`

- [ ] **Step 1: Write failing test**

```typescript
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoomList } from './RoomList';

describe('RoomList', () => {
  it('renders empty state when no rooms', () => {
    render(<RoomList rooms={[]} onJoin={() => {}} />);
    expect(screen.getByText(/no public rooms yet/i)).toBeInTheDocument();
  });

  it('renders a RoomCard per room', () => {
    const rooms = [1, 2, 3].map((n) => ({
      id: `r-${n}`, code: null, displayName: `Table ${n}`, phase: 'waiting' as const,
      hostName: 'Host', allowAiFill: false, visibility: 'public' as const,
      slotSummary: { humans: 1, ai: 0, open: 1, locked: 0, capacity: 2 },
      config: { ruleset: 'recommended', stockPileSize: 10, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null } as any,
      createdAt: n,
    }));
    render(<RoomList rooms={rooms} onJoin={() => {}} />);
    expect(screen.getAllByText(/Table \d/)).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Implement**

```typescript
'use client';

import type { RoomInfo } from '@/lib/net/protocol';
import { RoomCard } from './RoomCard';

export interface RoomListProps {
  rooms: RoomInfo[];
  onJoin: (roomId: string) => void;
}

export function RoomList({ rooms, onJoin }: RoomListProps) {
  if (rooms.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/15 bg-black/20 px-6 py-8 text-center text-sm text-white/50">
        No public rooms yet. Create one to get started.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {rooms.map((room) => (
        <RoomCard key={room.id} room={room} onJoin={onJoin} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Run + commit**

```bash
npm test -- RoomList
git add src/components/lobby/RoomList.tsx src/components/lobby/RoomList.test.tsx
git commit -m "Add RoomList rendering RoomCard per room with empty state"
```

---

### Task 20: Lobby shell + app/page.tsx

**Depends on:** Tasks 6, 7, 8, 10, 12, 13, 14, 19.

**Files:**
- Create: `src/components/lobby/Lobby.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Build the Lobby shell**

Create `src/components/lobby/Lobby.tsx`:

```typescript
'use client';

import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import Link from 'next/link';
import { RoomList } from './RoomList';
import { CreateRoomForm } from './CreateRoomForm';
import { JoinByCodeForm } from './JoinByCodeForm';
import { StatsChip } from './StatsChip';
import { DisplayNameEditor } from './DisplayNameEditor';
import { useLobbyStream } from '@/lib/net/useLobbyStream';
import { joinRoom, ApiError } from '@/lib/net/api';
import { useState } from 'react';

export interface LobbyProps {
  baseUrl: string;
  sessionId: string;
  displayName: string;
  onDisplayNameChange: (next: string) => void;
}

export function Lobby({ baseUrl, sessionId, displayName, onDisplayNameChange }: LobbyProps) {
  const router = useRouter();
  const { rooms, stats, connected } = useLobbyStream({ baseUrl, sessionId });
  const [joinError, setJoinError] = useState<string | null>(null);

  const handleJoin = useCallback(async (roomId: string) => {
    setJoinError(null);
    try {
      await joinRoom({ baseUrl, sessionId, roomId, playerName: displayName });
      router.push(`/rooms/${roomId}`);
    } catch (err) {
      setJoinError(err instanceof ApiError ? (err.detail ?? err.title) : String(err));
    }
  }, [baseUrl, sessionId, displayName, router]);

  const handleCreated = (roomId: string) => router.push(`/rooms/${roomId}`);
  const handleJoinedByCode = (roomId: string) => router.push(`/rooms/${roomId}`);

  return (
    <main className="min-h-screen wood-frame p-4 sm:p-6">
      <div className="felt-surface rounded-xl p-4 sm:p-8 max-w-6xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-xl sm:text-2xl font-bold tracking-widest text-white">
            SKIP<span className="text-[var(--gold)]">·</span>BO
          </h1>
          <div className="flex items-center gap-3">
            <StatsChip stats={stats} connected={connected} />
            <DisplayNameEditor name={displayName} onChange={onDisplayNameChange} />
          </div>
        </header>

        <div className="grid md:grid-cols-[1fr_320px] gap-6">
          <section>
            <h2 className="text-sm uppercase tracking-wider text-white/60 mb-3">Public rooms</h2>
            <RoomList rooms={rooms} onJoin={handleJoin} />
            {joinError && <div className="mt-3 text-xs text-rose-300">{joinError}</div>}
          </section>
          <aside className="space-y-6">
            <CreateRoomForm baseUrl={baseUrl} sessionId={sessionId} playerName={displayName} onCreated={handleCreated} />
            <JoinByCodeForm baseUrl={baseUrl} sessionId={sessionId} playerName={displayName} onJoined={handleJoinedByCode} />
            <div className="pt-4 border-t border-white/10 text-xs text-white/50">
              <Link href="/local" className="underline decoration-dotted hover:text-white">
                Play hot-seat (local)
              </Link>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Replace app/page.tsx**

Replace `src/app/page.tsx` entirely:

```typescript
'use client';

import { useState, useEffect } from 'react';
import { Lobby } from '@/components/lobby/Lobby';
import { useDisplayName } from '@/lib/net/useDisplayName';

function useSessionId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    let existing = localStorage.getItem('skipboSessionId');
    if (!existing) {
      existing = crypto.randomUUID();
      localStorage.setItem('skipboSessionId', existing);
    }
    setId(existing);
  }, []);
  return id;
}

export default function LandingPage() {
  const sessionId = useSessionId();
  const [name, setName] = useDisplayName();
  const [draft, setDraft] = useState('');

  const baseUrl = process.env.NEXT_PUBLIC_GAME_API_URL ?? 'http://localhost:8787';

  if (!sessionId) {
    return <LandingFrame><Loading>Loading…</Loading></LandingFrame>;
  }
  if (!name) {
    return (
      <LandingFrame>
        <form
          onSubmit={(e) => { e.preventDefault(); const v = draft.trim(); if (v) setName(v); }}
          className="space-y-4 text-center"
        >
          <h1 className="text-2xl text-white">Pick a name</h1>
          <input
            autoFocus
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Your display name"
            className="bg-black/40 border border-white/15 rounded px-3 py-2 text-white text-sm"
          />
          <div>
            <button type="submit" className="bg-[var(--gold)] text-stone-900 font-semibold hover:brightness-110 px-4 py-2 rounded text-sm">
              Continue
            </button>
          </div>
        </form>
      </LandingFrame>
    );
  }

  return <Lobby baseUrl={baseUrl} sessionId={sessionId} displayName={name} onDisplayNameChange={setName} />;
}

function LandingFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen wood-frame flex items-center justify-center p-6">
      <div className="felt-surface rounded-xl p-8 max-w-md w-full">{children}</div>
    </main>
  );
}

function Loading({ children }: { children: React.ReactNode }) {
  return <div className="text-center text-white/50 italic">{children}</div>;
}
```

- [ ] **Step 3: Run tests + typecheck**

```bash
npm test
npx tsc --noEmit
```

Expected: all client tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/lobby/Lobby.tsx src/app/page.tsx
git commit -m "Replace landing page with lobby and name-picker gate"
```

---

### Task 21: PreGameRoom shell

**Depends on:** Tasks 9, 15, 16, 17, 18 (all waiting-room components), Task 7 (api.ts).

**Files:**
- Create: `src/components/room/PreGameRoom.tsx`

- [ ] **Step 1: Implement**

```typescript
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import NewGameModal, { NewGameSettings } from '@/components/NewGameModal';
import { SlotList } from './SlotList';
import { ConfigSummary } from './ConfigSummary';
import { ChatPanel } from './ChatPanel';
import { StartButton } from './StartButton';
import { leaveRoom, patchRoom, setSlot, startGame, ApiError } from '@/lib/net/api';
import type { GameViewSeat, PublicGameConfig, ChatEntry } from '@/lib/net/protocol';

export interface PreGameRoomProps {
  baseUrl: string;
  sessionId: string;
  roomId: string;
  seats: GameViewSeat[];
  config: PublicGameConfig;
  hostSlotIndex: number | null;
  youSlotIndex: number;
  chat: ChatEntry[];
  onSendChat: (text: string) => void;
  allowAiFill: boolean;
}

export function PreGameRoom(props: PreGameRoomProps) {
  const router = useRouter();
  const isHost = props.youSlotIndex === props.hostSlotIndex;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slotSummary = summarize(props.seats);

  const handleSetSlot = async (index: number, desired: { kind: 'open' | 'locked' } | { kind: 'ai'; difficulty: 'easy' }) => {
    setError(null);
    try {
      await setSlot({ baseUrl: props.baseUrl, sessionId: props.sessionId, roomId: props.roomId, index, desired });
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.title) : String(err));
    }
  };

  const handleStart = async () => {
    setBusy(true);
    setError(null);
    try {
      await startGame({ baseUrl: props.baseUrl, sessionId: props.sessionId, roomId: props.roomId });
      // phase flip will arrive on the socket; the parent route re-renders to Board.
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.title) : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleLeave = async () => {
    try {
      await leaveRoom({ baseUrl: props.baseUrl, sessionId: props.sessionId, roomId: props.roomId, targetSessionId: props.sessionId });
    } catch { /* ignore leave failures — navigating away anyway */ }
    router.push('/');
  };

  const handleEditSave = async (settings: NewGameSettings) => {
    setError(null);
    try {
      await patchRoom({
        baseUrl: props.baseUrl,
        sessionId: props.sessionId,
        roomId: props.roomId,
        patch: {
          config: {
            ...props.config,
            ruleset: settings.ruleset,
            stockPileSize: settings.stockPileSize,
            handSize: settings.handSize,
            bidirectionalBuild: settings.bidirectionalBuild,
            // maxPlayers + partnership team shape locked in edit mode
          } as any,
        },
      });
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.title) : String(err));
    }
  };

  const initialSettings: NewGameSettings = {
    playerCount: props.config.maxPlayers,
    ruleset: props.config.ruleset,
    stockPileSize: props.config.stockPileSize,
    handSize: props.config.handSize,
    bidirectionalBuild: props.config.bidirectionalBuild,
    partnership: !!props.config.partnership?.enabled,
  } as NewGameSettings;

  return (
    <main className="min-h-screen wood-frame p-4 sm:p-6">
      <div className="felt-surface rounded-xl p-4 sm:p-8 max-w-3xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-lg sm:text-xl font-bold tracking-widest text-white">WAITING ROOM</h1>
          <button
            type="button"
            onClick={handleLeave}
            className="text-xs text-white/60 hover:text-white underline decoration-dotted"
          >
            Leave room
          </button>
        </header>

        <section>
          <h2 className="text-xs uppercase tracking-wider text-white/70 font-semibold mb-2">Players</h2>
          <SlotList
            seats={props.seats}
            youSlotIndex={props.youSlotIndex}
            isHost={isHost}
            onSetSlot={handleSetSlot}
          />
        </section>

        <ConfigSummary config={props.config} isHost={isHost} onEdit={() => setEditing(true)} />

        <ChatPanel chat={props.chat} onSend={props.onSendChat} />

        {isHost && (
          <div className="flex justify-end">
            <StartButton
              slotSummary={slotSummary}
              allowAiFill={props.allowAiFill}
              busy={busy}
              onClick={handleStart}
            />
          </div>
        )}

        {error && <div className="text-xs text-rose-300">{error}</div>}
      </div>

      <NewGameModal
        open={editing}
        onCancel={() => setEditing(false)}
        onStart={handleEditSave}
        defaultPlayerCount={props.config.maxPlayers}
        initial={initialSettings}
        editMode
      />
    </main>
  );
}

function summarize(seats: GameViewSeat[]): { humans: number; ai: number; open: number; locked: number; capacity: number } {
  const s = { humans: 0, ai: 0, open: 0, locked: 0, capacity: seats.length };
  for (const seat of seats) {
    if (seat.kind === 'human') s.humans++;
    else if (seat.kind === 'ai') s.ai++;
    else if (seat.kind === 'open') s.open++;
    else s.locked++;
  }
  return s;
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

Fix any type errors (likely around `PublicGameConfig` shape — the `as any` cast on the patch body is a known rough edge; if time permits, inline the proper patch type).

- [ ] **Step 3: Commit**

```bash
git add src/components/room/PreGameRoom.tsx
git commit -m "Add PreGameRoom shell wiring slots, config, chat, start, leave"
```

---

### Task 22: Phase-branch /rooms/[roomId]

**Depends on:** Task 21.

**Files:**
- Modify: `src/app/rooms/[roomId]/page.tsx`

- [ ] **Step 1: Read the current file**

```bash
cat src/app/rooms/[roomId]/page.tsx
```

Note where Board is rendered and how socket state is consumed.

- [ ] **Step 2: Add the phase branch + PreGameRoom render**

Wrap the existing Board render with a conditional. When `socket.view.view === null`, render `<PreGameRoom>` instead. Pass through the socket's `seats`, `config`, `hostSlotIndex`, `chat`, `sendChat`, plus the session/base-url and room context.

Key insertions (around the existing `const { view, seats } = socket.view;` block):

```typescript
const baseUrl = process.env.NEXT_PUBLIC_GAME_API_URL ?? 'http://localhost:8787';

// Phase branch — waiting room vs playing Board.
if (socket.view.view === null) {
  return (
    <PreGameRoom
      baseUrl={baseUrl}
      sessionId={sessionId}
      roomId={roomId}
      seats={socket.view.seats}
      config={/* need to carry config in GameView — see Step 3 below */}
      hostSlotIndex={socket.view.hostSlotIndex}
      youSlotIndex={/* socket must expose youSlotIndex even with null view */}
      chat={socket.chat}
      onSendChat={socket.sendChat}
      allowAiFill={/* needs to ride the GameView too */}
    />
  );
}

// else fall through to existing Board render
```

- [ ] **Step 3: Extend GameView to carry config + allowAiFill + youSlotIndex for waiting**

`GameView.view` is null during waiting, but PreGameRoom needs `config`, `allowAiFill`, `youSlotIndex`. Two options:
- (a) Add these fields to `GameView` directly (always present).
- (b) Leave PreGameRoom to fetch the room once via `GET /v1/rooms/:id`.

Pick (a). Update `src/lib/net/protocol.ts`:

```typescript
export interface GameView {
  view: PlayerView | null;
  seats: GameViewSeat[];
  hostSlotIndex: number | null;
  // These ride the GameView so the pre-game room can render without a
  // separate REST round-trip. They are duplicates of fields the playing-
  // phase PlayerView would expose via `view.config` — inlining here keeps
  // the waiting-phase UI self-contained.
  config: PublicGameConfig;
  allowAiFill: boolean;
  youSlotIndex: number;
}
```

Then update `server/src/game/view.ts:buildGameView` to populate these on every return path (including waiting-phase).

- [ ] **Step 4: Run server + client tests**

```bash
cd server
npm test
cd ..
npm test
npx tsc --noEmit
```

Fix compile errors from the GameView shape change (mostly in existing tests that construct fake GameViews).

- [ ] **Step 5: Commit**

```bash
git add src/app/rooms/[roomId]/page.tsx src/lib/net/protocol.ts server/src/game/protocol.ts server/src/game/view.ts server/tests/game/view.test.ts
git commit -m "Phase-branch rooms page to render PreGameRoom when view is null"
```

---

### Task 23: Lobby integration test

**Depends on:** Task 20.

**Files:**
- Create: `src/app/page.integration.test.tsx`

- [ ] **Step 1: Write the integration test**

Mount the landing page with a mocked EventSource + fetch, simulate a snapshot, click Join on a room card, verify `router.push` spy.

```typescript
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import LandingPage from './page';

// Mock next/navigation's useRouter.
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

class MockEventSource {
  static last: MockEventSource | null = null;
  url: string;
  private listeners = new Map<string, Array<(e: MessageEvent) => void>>();
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    MockEventSource.last = this;
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(fn);
  }
  removeEventListener(type: string, fn: (e: MessageEvent) => void) {
    const arr = this.listeners.get(type);
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }
  close() {}
  fire(type: string, data: unknown) {
    const ev = new MessageEvent(type, { data: JSON.stringify(data) });
    (this.listeners.get(type) ?? []).forEach((fn) => fn(ev));
  }
}

const fetchMock = vi.fn();

beforeEach(() => {
  push.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('EventSource', MockEventSource);
  vi.stubGlobal('fetch', fetchMock);
  localStorage.setItem('skipboSessionId', 'test-session');
  localStorage.setItem('skipboDisplayName', 'Tester');
});

describe('LandingPage integration', () => {
  it('joins a room from the snapshot and navigates', async () => {
    fetchMock.mockResolvedValue(new Response(
      JSON.stringify({ slotIndex: 1, room: { id: 'r-abc' } }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    ));
    render(<LandingPage />);
    await waitFor(() => expect(MockEventSource.last).not.toBeNull());
    act(() => {
      MockEventSource.last!.fire('snapshot', {
        type: 'snapshot',
        rooms: [{
          id: 'r-abc', code: null, displayName: 'Cool Table', phase: 'waiting', hostName: 'Alice',
          allowAiFill: false, visibility: 'public',
          slotSummary: { humans: 1, ai: 0, open: 1, locked: 0, capacity: 2 },
          config: { ruleset: 'recommended', stockPileSize: 10, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null },
          createdAt: 0,
        }],
        stats: { gamesInProgress: 0, playersOnline: 1 },
      });
    });
    fireEvent.click(screen.getByRole('button', { name: /join/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/rooms/r-abc'));
  });
});
```

- [ ] **Step 2: Run**

```bash
npm test -- page.integration
```

Fix any test-environment quirks (e.g., typing error from `Response` body needing to be `BodyInit`).

- [ ] **Step 3: Commit**

```bash
git add src/app/page.integration.test.tsx
git commit -m "Add lobby integration test covering snapshot then join click"
```

---

### Task 24: PreGameRoom integration test

**Depends on:** Task 22.

**Files:**
- Create: `src/app/rooms/[roomId]/page.integration.test.tsx`

- [ ] **Step 1: Write the test**

Pattern after existing `src/lib/net/useGameSocket.test.ts` for WS mocking. Verify: null view renders PreGameRoom, populated view renders Board.

```typescript
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import NetworkedRoomPage from './page';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

// Minimal WebSocket mock following the existing useGameSocket.test pattern.
class MockWebSocket {
  static last: MockWebSocket | null = null;
  readyState = 0; OPEN = 1; CLOSED = 3;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  bufferedAmount = 0;
  constructor(public url: string) { MockWebSocket.last = this; }
  send() {}
  close(code = 1000, reason = '') { this.onclose?.(new CloseEvent('close', { code, reason })); }
  deliver(msg: unknown) { this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(msg) })); }
  open() { this.readyState = 1; this.onopen?.(new Event('open')); }
}

beforeEach(() => {
  vi.stubGlobal('WebSocket', MockWebSocket);
  localStorage.setItem('skipboSessionId', 'test-session');
});

describe('rooms/[roomId] phase branch', () => {
  it('renders PreGameRoom when hello has view: null', async () => {
    render(<NetworkedRoomPage params={Promise.resolve({ roomId: 'r-1' })} />);
    await act(async () => {});
    MockWebSocket.last!.open();
    act(() => {
      MockWebSocket.last!.deliver({
        type: 'hello', stateVersion: 0,
        view: {
          view: null,
          seats: [
            { slotIndex: 0, kind: 'human', name: 'Me', connected: true, graceDeadline: null, botControlled: false, isHost: true },
            { slotIndex: 1, kind: 'open', name: null, connected: false, graceDeadline: null, botControlled: false, isHost: false },
          ],
          hostSlotIndex: 0,
          config: { ruleset: 'recommended', stockPileSize: 10, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null },
          allowAiFill: false,
          youSlotIndex: 0,
        },
      });
    });
    expect(await screen.findByText(/waiting room/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
npm test -- rooms.*integration
git add "src/app/rooms/[roomId]/page.integration.test.tsx"
git commit -m "Add PreGameRoom integration test for null-view phase branch"
```

---

## Phase 5 — Verification

### Task 25: Full-suite gate

**Depends on:** Tasks 1-24.

- [ ] **Step 1: Run every suite**

```bash
npm test
cd server
npm test
cd ..
npx tsc --noEmit
cd server
npx tsc --noEmit
cd ..
```

Expected:
- Client tests: 96 previous + ~30 new = ~126 passing.
- Server tests: 135 previous + ~10 new = ~145 passing.
- Server typecheck: clean.
- Root typecheck: fails only on pre-existing follow-up #13 (`@engine/*` alias for server/ files). Any new root-level errors must be fixed before moving on.

- [ ] **Step 2: If any suite fails, fix and commit per atomic commit rule — do not batch**

---

### Task 26: Browser verification at 1280×800 and 390×844

**Depends on:** Task 25.

- [ ] **Step 1: Start both dev servers in one terminal each**

```bash
# Terminal A (server)
cd server
npm run build
npm start
```

Expected: `server listening` log at port 8787.

```bash
# Terminal B (client)
npm run dev
```

Expected: Next.js dev server on port 3000 or 3001.

- [ ] **Step 2: Desktop walk-through**

With Playwright MCP or a browser:

1. Navigate to `http://localhost:3000/` (or 3001). Pick a name. Land in the lobby.
2. Click "Open settings" in Create Room, pick 2-player recommended, submit. URL changes to `/rooms/:id`, PreGameRoom renders with one human + one open slot.
3. Open a second browser tab (or incognito) at `http://localhost:3000/`. Pick a different name.
4. In tab 2: take the code from tab 1's URL (pull it from the lobby server or use the code visible to the host — for now, join via the lobby list since it's public).
5. Both tabs see two humans in the seats. Chat a message from tab 1; tab 2 renders it.
6. In tab 1 (host): click Start game. Both tabs transition to the Board. No disconnect.
7. Play a winning move (or force via the engine). Both tabs render WinModal. Click "Keep same group". Both tabs navigate to the rematch room and see a fresh Board.

- [ ] **Step 3: Mobile walk-through at 390×844**

Repeat the same flow on mobile viewport. Verify lobby stacks to single column, PreGameRoom stacks, Board uses compact layout.

- [ ] **Step 4: Document any rough edges as follow-ups in CLAUDE.md**

Open CLAUDE.md's Follow-ups section and append any non-blocking rough edges you surface (e.g., "host slot-kind dropdown flicker when broadcast lands mid-select", "code-copy button missing in PreGameRoom").

- [ ] **Step 5: Final commit if any fixes landed**

```bash
git add .
git commit -m "Polish lobby flow from browser walk-through findings"
```

- [ ] **Step 6: Update CLAUDE.md to reflect Section 6.5 shipped**

Update "Where we left off" in `CLAUDE.md`:

```markdown
## 🔖 Where we left off

Section 6.5 (lobby + AoE2-style pre-game room) shipped on `feature/section-6.5-lobby`.
Landing page is now the lobby (SSE-backed public rooms list, create/join forms,
display-name gate). `/rooms/[roomId]` phase-branches between `<PreGameRoom>`
(waiting) and `<Board>` (playing). Game WS handshake now accepts waiting-phase
connections so one socket covers both views.

**Next up — Section 5 (AI bots).** Random-legal stub at `server/src/game/bot.ts`.
Replace with rule-based / heuristic strategy. Same `applyAction` contract.
Section 7 (AWS deploy) after that.
```

```bash
git add CLAUDE.md
git commit -m "Refresh CLAUDE.md to reflect Section 6.5 lobby shipped"
```

---

## Self-review notes (for the orchestrator)

This plan was written for a parallel orchestrator. Key coordination points:

- **Phase 1 is the gate.** Tasks 2, 3, 4 can run in parallel only after Task 1 lands. Tasks 5-9 parallelize with Phase 1.
- **Phase 3 components are isolated.** Tasks 10-18 can all run in parallel with no coordination — each creates its own file and tests in isolation.
- **Phase 4 is serial.** RoomList depends on RoomCard; Lobby depends on all sub-components; PreGameRoom depends on all room sub-components; phase-branch in `/rooms/[roomId]` depends on PreGameRoom.
- **Phase 5 gates shipping.** Do not skip the browser walk-through. Unit tests don't catch CSS/layout/focus issues that matter for a UX-heavy deliverable.
- **Commit per step, not per task.** Each step ends with a commit or a test run. Do not batch tasks into a single commit.
- **Merge discipline.** After each phase completes on `section-6.5`, rebase against `section-6` if it has moved, and verify full suite still passes.

If any task's scope grows beyond its budget, split it — a task should fit in one subagent dispatch with room for the review round trip.
