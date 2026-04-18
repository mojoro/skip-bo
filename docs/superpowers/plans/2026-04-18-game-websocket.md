# Game WebSocket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Section 3 — a real-time game WebSocket layer on top of the Section 4 Room Manager — per `docs/superpowers/specs/2026-04-18-game-websocket-design.md`. Adds a single `/rooms/:roomId/game?sessionId=...` endpoint that carries every in-game action, broadcasts `GameView` snapshots (engine `PlayerView` + per-slot presence), enforces a 60 s disconnect grace window with bot takeover, and exposes a `useGameSocket` React hook for the client.

**Architecture:** New `server/src/game/` module. `handshake.ts` owns the HTTP Upgrade handler (origin / session / duplicate checks); `connection.ts` owns per-socket lifecycle; `registry.ts` owns the `Map<roomId, Set<GameConnection>>`; `dispatch.ts` is pure message-routing; `grace.ts` + `bot.ts` handle disconnect timers and post-grace bot turns. `Slot.human` gains `graceDeadline`, `graceTimer`, `botControlled`; `Room` gains `botPending: Set<number>`. Engine stays untouched — the server wraps `getPlayerView` in a `GameView` that stamps per-slot presence. Client side adds `src/lib/net/useGameSocket.ts`, splits the existing hot-seat demo into `/local` and adds a networked `/rooms/[roomId]` route.

**Tech Stack:** Node 20+ · TypeScript strict · `ws@^8.18.0` (already in `server/package.json`) · `zod` (message validation) · Vitest · React 19 · Next.js 16 App Router.

**What this plan does NOT do:**
- Spectator connections (reserved path, not implemented).
- Action replay log — full snapshots only.
- Non-random bot strategy (Section 5).
- Chat moderation beyond length cap + control-char strip.
- Game-state persistence (still in-memory).

---

## File structure

```
skip-bo/
├── server/
│   ├── src/
│   │   ├── types.ts                       # MODIFY: extend Slot.human, add Room.botPending
│   │   ├── room/
│   │   │   ├── manager.ts                 # MODIFY: initial slot fields, cleanup follow-ups
│   │   │   └── lifecycle.ts               # MODIFY: clear all grace timers on finish/delete
│   │   ├── shutdown.ts                    # MODIFY: broadcastClose + timer sweep
│   │   ├── index.ts                       # MODIFY: wire GameRegistry + upgrade handler
│   │   └── game/                          # NEW
│   │       ├── protocol.ts                # Zod ClientMessage schemas + TS ServerMessage types
│   │       ├── mapping.ts                 # slotIndex to playerIndex helpers
│   │       ├── view.ts                    # GameView type + buildGameView()
│   │       ├── registry.ts                # GameRegistry class
│   │       ├── dispatch.ts                # pure dispatch(room, sessionId, msg) -> effects
│   │       ├── grace.ts                   # startGrace / cancelGrace / expireGrace
│   │       ├── bot.ts                     # maybeRunBotTurn + pickRandomLegalAction
│   │       ├── connection.ts              # GameConnection class
│   │       └── handshake.ts               # HTTP upgrade handler
│   └── tests/
│       ├── fixtures.ts                    # MODIFY: backfill new Slot.human fields
│       └── game/                          # NEW
│           ├── protocol.test.ts
│           ├── mapping.test.ts
│           ├── view.test.ts
│           ├── dispatch.test.ts
│           ├── grace.test.ts
│           ├── bot.test.ts
│           ├── registry.test.ts
│           ├── handshake.test.ts          # integration (real sockets)
│           └── fullFlow.test.ts           # integration (real sockets)
└── src/
    ├── app/
    │   ├── page.tsx                       # MOVE: keep as lobby landing, strip hot-seat board
    │   ├── local/
    │   │   └── page.tsx                   # NEW: hot-seat demo (carried over from old page.tsx)
    │   └── rooms/
    │       └── [roomId]/
    │           └── page.tsx               # NEW: networked game board
    ├── components/
    │   ├── Seat.tsx                       # MODIFY: narrow props to GameView slice
    │   ├── TableCenter.tsx                # MODIFY: narrow props to GameView slice
    │   └── MobileBoard.tsx                # MODIFY: narrow props to GameView slice
    └── lib/
        └── net/                           # NEW
            ├── protocol.ts                # shared ClientMessage / ServerMessage / GameView types
            └── useGameSocket.ts           # the hook
```

**Commit convention (project rule):** single-line subject completing "This commit will ...", under 75 chars, no Conventional-Commits prefixes, no body, no Co-Authored-By. Atomic commits — one logical change per commit. Every task ends with a commit step.

**Test runner:** all server tests run from `server/` via `npx vitest run <path>`. All main-app tests run from repo root via `npx vitest run <path>`.

---

## Task 1: Extend `Slot.human` and `Room` types

**Files:**
- Modify: `server/src/types.ts`
- Modify: `server/tests/fixtures.ts`
- Modify: `server/src/room/manager.ts` (field backfill at construction)

This is a type-only task; existing behavior must continue to compile and pass. The new fields land with sane defaults (`null`, `false`) so every code path that doesn't care about grace is unchanged.

- [ ] **Step 1: Extend `Slot` union and `Room` in `server/src/types.ts`**

Replace the current `Slot` and `Room` definitions with:

```ts
import type { GameConfig, GameState } from '@engine/types';

export type RoomPhase = 'waiting' | 'playing' | 'finished';
export type Visibility = 'public' | 'private';

export type Slot =
  | { kind: 'open' }
  | { kind: 'locked' }
  | {
      kind: 'human';
      sessionId: string;
      name: string;
      connected: boolean;
      joinedAt: number;
      graceDeadline: number | null;
      graceTimer: NodeJS.Timeout | null;
      botControlled: boolean;
    }
  | { kind: 'ai'; botId: string; difficulty: 'easy' };

export interface Room {
  id: string;
  code: string;
  displayName: string;
  visibility: Visibility;
  phase: RoomPhase;
  hostSessionId: string;
  config: GameConfig;
  allowAiFill: boolean;
  slots: Slot[];
  game: GameState | null;
  createdAt: number;
  lastActivityAt: number;
  finishedAt: number | null;
  kickedSessionIds: Set<string>;
  idleTimer: NodeJS.Timeout | null;
  cleanupTimer: NodeJS.Timeout | null;
  botPending: Set<number>;
}
```

(`RoomInfo`, `LobbyStats`, `LobbyEvent`, `FinishReason` stay untouched.)

- [ ] **Step 2: Backfill `Room.botPending` in `server/src/room/manager.ts`**

In `RoomManager.create`, inside the `const room: Room = { ... }` literal, add `botPending: new Set<number>(),` alongside `kickedSessionIds`.

- [ ] **Step 3: Backfill human-slot fields in `server/src/room/manager.ts`**

Two call sites create `{ kind: 'human', ... }` slot literals — `buildInitialSlots` and `addMember`. Add the three new fields with defaults to both:

```ts
{
  kind: 'human',
  sessionId: input.sessionId,
  name: input.playerName,
  connected: false,
  joinedAt: Date.now(),
  graceDeadline: null,
  graceTimer: null,
  botControlled: false,
}
```

- [ ] **Step 4: Update `server/tests/fixtures.ts` `makeRoom`**

The host slot literal needs the same three fields (`graceDeadline: null`, `graceTimer: null`, `botControlled: false`), plus `botPending: new Set<number>()` on the Room.

- [ ] **Step 5: Typecheck**

Run: `cd server && npm run typecheck`
Expected: no errors. (If any other file constructs a `human` slot literal directly, TypeScript will complain — fix those by adding the three fields; do not change behavior.)

- [ ] **Step 6: Full test suite as regression guard**

Run: `cd server && npm test`
Expected: all 69 existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/types.ts server/src/room/manager.ts server/tests/fixtures.ts
git commit -m "Extend Slot.human with grace fields and add Room.botPending"
```

---

## Task 2: Clear slot grace timers in lifecycle + fix double roomRemoved

**Files:**
- Modify: `server/src/room/lifecycle.ts`
- Modify: `server/src/room/manager.ts`
- Modify: `server/tests/room/manager.test.ts`

Closes CLAUDE.md follow-ups #2 and #3 so Task 11 can depend on invariants. `finishGame` and `deleteRoom` must sweep every `Slot.human.graceTimer`; the `emitRoomRemoved` double-emit is guarded by `rooms.has(room.id)` so the cleanup-timer path doesn't fire a second one.

- [ ] **Step 1: Write a failing regression test for double-emit**

Append to `server/tests/room/manager.test.ts`:

```ts
it('emits roomRemoved exactly once when finish then cleanup runs', async () => {
  vi.useFakeTimers();
  try {
    const mgr = new RoomManager();
    const removed: string[] = [];
    mgr.events.on('roomRemoved', (e) => removed.push(e.roomId));
    const { room } = mgr.create({
      sessionId: 's1', playerName: 'Host',
      config: { ruleset: 'recommended', stockPileSize: 20, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null },
      allowAiFill: true, visibility: 'public',
    });
    mgr.addMember(room.id, { sessionId: 's2', playerName: 'P2' });
    mgr.startGame(room.id, { actorSessionId: 's1' }); // first roomRemoved (lobby leave)
    mgr.finishGame(room.id, 'winner');                 // second emit
    vi.advanceTimersByTime(6 * 60 * 1000);             // fire cleanup timer
    expect(removed.filter((id) => id === room.id)).toHaveLength(2);
  } finally {
    vi.useRealTimers();
  }
});
```

Note the assertion expects **2**, not 3 — `startGame` already emits one `roomRemoved` (lobby takedown), `finishGame` emits a second when the room stays resident with phase `finished`, and the cleanup path must not emit a third.

- [ ] **Step 2: Run test, expect failure with 3 emits**

Run: `cd server && npx vitest run tests/room/manager.test.ts`
Expected: FAIL — received `3`, expected `2`.

- [ ] **Step 3: Guard `emitRoomRemoved`**

In `server/src/room/manager.ts`, change `emitRoomRemoved` to:

```ts
private emitRoomRemoved(room: Room): void {
  if (room.visibility !== 'public') return;
  if (!this.rooms.has(room.id) && !this._allowPostDeleteEmit) return;
  this.events.emit('roomRemoved', { type: 'roomRemoved', roomId: room.id });
}
```

Then add a private field `private _allowPostDeleteEmit = false;` and wrap the `deleteRoom` body so the final emit is authorised:

```ts
private deleteRoom(room: Room, _opts: { reason: 'idle' | 'postGame' | 'empty' }): void {
  this.rooms.delete(room.id);
  this.codeIndex.delete(room.code);
  for (const slot of room.slots) {
    if (slot.kind === 'human') this.sessionIndex.delete(slot.sessionId);
  }
  this.clearIdleTimer(room);
  if (room.cleanupTimer) { clearTimeout(room.cleanupTimer); room.cleanupTimer = null; }
  for (const slot of room.slots) {
    if (slot.kind === 'human' && slot.graceTimer) {
      clearTimeout(slot.graceTimer);
      slot.graceTimer = null;
      slot.graceDeadline = null;
    }
  }
  this._allowPostDeleteEmit = true;
  try { this.emitRoomRemoved(room); } finally { this._allowPostDeleteEmit = false; }
}
```

- [ ] **Step 4: Also defensively clear idle timer in `finishGame`**

In `finishGame`, right after `markFinished(room, reason);`, add `this.clearIdleTimer(room);`. (Invariant hygiene — covers CLAUDE.md follow-up #3.)

- [ ] **Step 5: Re-run the regression test and full suite**

Run: `cd server && npm test`
Expected: all 70 tests (69 + new one) pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/room/manager.ts server/tests/room/manager.test.ts
git commit -m "Gate emitRoomRemoved post-delete and clear timers on finish"
```

---

## Task 3: Zod protocol schemas and TS server-message types

**Files:**
- Create: `server/src/game/protocol.ts`
- Create: `server/tests/game/protocol.test.ts`

Pure module; no imports from `room/` or `http/`. Runtime validation for inbound; compile-time types for outbound.

- [ ] **Step 1: Write failing tests**

Create `server/tests/game/protocol.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ClientMessageSchema, MAX_CHAT_LEN, MAX_MESSAGE_BYTES } from '../../src/game/protocol';

describe('ClientMessageSchema', () => {
  it('accepts a valid action message', () => {
    const parsed = ClientMessageSchema.safeParse({
      type: 'action',
      action: { type: 'DISCARD', handIndex: 0, discardPileIndex: 1, targetPlayerIndex: 0 },
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts a valid chat message', () => {
    const parsed = ClientMessageSchema.safeParse({ type: 'chat', text: 'gg' });
    expect(parsed.success).toBe(true);
  });

  it('rejects unknown type', () => {
    const parsed = ClientMessageSchema.safeParse({ type: 'hello' });
    expect(parsed.success).toBe(false);
  });

  it('rejects chat over length cap', () => {
    const parsed = ClientMessageSchema.safeParse({
      type: 'chat', text: 'x'.repeat(MAX_CHAT_LEN + 1),
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects non-object payloads', () => {
    expect(ClientMessageSchema.safeParse(null).success).toBe(false);
    expect(ClientMessageSchema.safeParse(42).success).toBe(false);
    expect(ClientMessageSchema.safeParse('action').success).toBe(false);
  });

  it('exposes a 16 KB max message size', () => {
    expect(MAX_MESSAGE_BYTES).toBe(16 * 1024);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd server && npx vitest run tests/game/protocol.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/game/protocol.ts`**

```ts
import { z } from 'zod';
import type { GameAction } from '@engine/types';
import type { GameView } from './view';

export const MAX_CHAT_LEN = 200;
export const MAX_MESSAGE_BYTES = 16 * 1024;

const CardSourceSchema = z.union([
  z.object({ from: z.literal('hand'), index: z.number().int().min(0) }),
  z.object({ from: z.literal('stock'), playerIndex: z.number().int().min(0) }),
  z.object({
    from: z.literal('discard'),
    playerIndex: z.number().int().min(0),
    pileIndex: z.number().int().min(0),
  }),
]);

const BuildDirectionSchema = z.union([z.literal('asc'), z.literal('desc'), z.null()]);

const GameActionSchema: z.ZodType<GameAction> = z.union([
  z.object({
    type: z.literal('PLAY_TO_BUILD'),
    source: CardSourceSchema,
    buildPileIndex: z.number().int().min(0),
    declaredDirection: BuildDirectionSchema.optional(),
  }),
  z.object({
    type: z.literal('DISCARD'),
    handIndex: z.number().int().min(0),
    discardPileIndex: z.number().int().min(0),
    targetPlayerIndex: z.number().int().min(0),
  }),
]);

export const ClientMessageSchema = z.union([
  z.object({ type: z.literal('action'), action: GameActionSchema }),
  z.object({ type: z.literal('chat'), text: z.string().min(1).max(MAX_CHAT_LEN) }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type ServerMessage =
  | { type: 'hello';       stateVersion: number; view: GameView }
  | { type: 'state';       stateVersion: number; view: GameView }
  | { type: 'actionError'; reason: string; stateVersion: number }
  | { type: 'chat';        fromSlotIndex: number; fromName: string; text: string; sentAt: number }
  | { type: 'gameEnded';   stateVersion: number; view: GameView; reason: 'winner' | 'abandoned' };
```

(`GameView` is defined in Task 5; TypeScript accepts a forward `import type` — the file won't exist yet, so expect a compile error here until Task 5 lands. That's fine because the test exercises runtime Zod only.)

- [ ] **Step 4: Sanity-compile only the protocol test for now**

Run: `cd server && npx vitest run tests/game/protocol.test.ts`
Expected: 6 passing. (Vitest tolerates the unresolved `import type` because it's erased.)

- [ ] **Step 5: Commit**

```bash
git add server/src/game/protocol.ts server/tests/game/protocol.test.ts
git commit -m "Define Zod ClientMessage schema and ServerMessage types"
```

---

## Task 4: Slot-to-player index mapping helper

**Files:**
- Create: `server/src/game/mapping.ts`
- Create: `server/tests/game/mapping.test.ts`

At game start the engine's `players` list filters out `open`/`locked` slots, so `slotIndex` is not equal to `playerIndex` whenever any slot was locked. Dispatch, bot, and view code all need a cheap mapping; centralise it here.

- [ ] **Step 1: Write failing tests**

Create `server/tests/game/mapping.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { slotIndexForPlayerId, playerIndexForSlotIndex } from '../../src/game/mapping';
import { makeRoom } from '../fixtures';
import { initializeGameState } from '../../src/room/lifecycle';

describe('slot/player mapping', () => {
  it('maps human sessionId and ai botId to their slot indices', () => {
    const room = makeRoom();
    room.slots = [
      { kind: 'human', sessionId: 'alice', name: 'A', connected: true, joinedAt: 0, graceDeadline: null, graceTimer: null, botControlled: false },
      { kind: 'locked' },
      { kind: 'ai', botId: 'bot-x', difficulty: 'easy' },
      { kind: 'human', sessionId: 'bob',   name: 'B', connected: true, joinedAt: 1, graceDeadline: null, graceTimer: null, botControlled: false },
    ];
    room.game = initializeGameState(room);
    expect(slotIndexForPlayerId(room, 'alice')).toBe(0);
    expect(slotIndexForPlayerId(room, 'bot-x')).toBe(2);
    expect(slotIndexForPlayerId(room, 'bob')).toBe(3);
    expect(slotIndexForPlayerId(room, 'ghost')).toBe(-1);
  });

  it('maps engine player index back to slot index skipping locked', () => {
    const room = makeRoom();
    room.slots = [
      { kind: 'human', sessionId: 'alice', name: 'A', connected: true, joinedAt: 0, graceDeadline: null, graceTimer: null, botControlled: false },
      { kind: 'locked' },
      { kind: 'ai', botId: 'bot-x', difficulty: 'easy' },
    ];
    room.game = initializeGameState(room);
    expect(playerIndexForSlotIndex(room, 0)).toBe(0); // alice = engine player 0
    expect(playerIndexForSlotIndex(room, 1)).toBe(-1); // locked has no player
    expect(playerIndexForSlotIndex(room, 2)).toBe(1); // bot-x = engine player 1
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd server && npx vitest run tests/game/mapping.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/game/mapping.ts`**

```ts
import type { Room } from '../types';

export function slotIndexForPlayerId(room: Room, playerId: string): number {
  return room.slots.findIndex((s) =>
    (s.kind === 'human' && s.sessionId === playerId) ||
    (s.kind === 'ai' && s.botId === playerId),
  );
}

export function playerIndexForSlotIndex(room: Room, slotIndex: number): number {
  if (!room.game) return -1;
  const slot = room.slots[slotIndex];
  if (!slot || (slot.kind !== 'human' && slot.kind !== 'ai')) return -1;
  const id = slot.kind === 'human' ? slot.sessionId : slot.botId;
  return room.game.players.findIndex((p) => p.id === id);
}

export function currentPlayerSlotIndex(room: Room): number {
  if (!room.game) return -1;
  const player = room.game.players[room.game.currentPlayerIndex];
  if (!player) return -1;
  return slotIndexForPlayerId(room, player.id);
}
```

- [ ] **Step 4: Run tests**

Run: `cd server && npx vitest run tests/game/mapping.test.ts`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/game/mapping.ts server/tests/game/mapping.test.ts
git commit -m "Add slot-to-player index mapping helpers"
```

---

## Task 5: `GameView` wrapper and `buildGameView`

**Files:**
- Create: `server/src/game/view.ts`
- Create: `server/tests/game/view.test.ts`

Wraps engine `PlayerView` with server-owned per-slot presence. Engine stays pure.

- [ ] **Step 1: Write failing tests**

Create `server/tests/game/view.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildGameView } from '../../src/game/view';
import { makeRoom } from '../fixtures';
import { initializeGameState } from '../../src/room/lifecycle';

describe('buildGameView', () => {
  it('stamps seat presence for every slot', () => {
    const room = makeRoom();
    room.slots = [
      { kind: 'human', sessionId: 'alice', name: 'Alice', connected: true,  joinedAt: 0, graceDeadline: null,    graceTimer: null, botControlled: false },
      { kind: 'human', sessionId: 'bob',   name: 'Bob',   connected: false, joinedAt: 1, graceDeadline: 1700,   graceTimer: null, botControlled: false },
      { kind: 'ai',    botId: 'bot-x',     difficulty: 'easy' },
      { kind: 'locked' },
    ];
    room.config.maxPlayers = 4;
    room.game = initializeGameState(room);
    const view = buildGameView(room, 'alice');
    expect(view.seats).toHaveLength(4);
    expect(view.seats[0]).toEqual({ slotIndex: 0, kind: 'human', name: 'Alice', connected: true,  graceDeadline: null,  botControlled: false });
    expect(view.seats[1]).toEqual({ slotIndex: 1, kind: 'human', name: 'Bob',   connected: false, graceDeadline: 1700,  botControlled: false });
    expect(view.seats[2]).toEqual({ slotIndex: 2, kind: 'ai',    name: 'bot-x', connected: true,  graceDeadline: null,  botControlled: false });
    expect(view.seats[3]).toEqual({ slotIndex: 3, kind: 'locked', name: null,   connected: false, graceDeadline: null,  botControlled: false });
    expect(view.view.youIndex).toBe(0);
  });

  it('throws if sessionId has no matching engine player', () => {
    const room = makeRoom();
    room.game = initializeGameState(room);
    expect(() => buildGameView(room, 'ghost')).toThrow();
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd server && npx vitest run tests/game/view.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/game/view.ts`**

```ts
import type { PlayerView } from '@engine/engine';
import { getPlayerView } from '@engine/engine';
import type { Room, Slot } from '../types';

export interface GameViewSeat {
  slotIndex: number;
  kind: Slot['kind'];
  name: string | null;
  connected: boolean;
  graceDeadline: number | null;
  botControlled: boolean;
}

export interface GameView {
  view: PlayerView;
  seats: GameViewSeat[];
}

export function buildGameView(room: Room, sessionId: string): GameView {
  if (!room.game) throw new Error('buildGameView: room has no game');
  const view = getPlayerView(room.game, sessionId);
  const seats: GameViewSeat[] = room.slots.map((slot, slotIndex) => {
    switch (slot.kind) {
      case 'human':
        return {
          slotIndex,
          kind: 'human',
          name: slot.name,
          connected: slot.connected,
          graceDeadline: slot.graceDeadline,
          botControlled: slot.botControlled,
        };
      case 'ai':
        return { slotIndex, kind: 'ai', name: slot.botId, connected: true, graceDeadline: null, botControlled: false };
      case 'open':
        return { slotIndex, kind: 'open', name: null, connected: false, graceDeadline: null, botControlled: false };
      case 'locked':
        return { slotIndex, kind: 'locked', name: null, connected: false, graceDeadline: null, botControlled: false };
    }
  });
  return { view, seats };
}
```

- [ ] **Step 4: Run tests**

Run: `cd server && npx vitest run tests/game/view.test.ts`
Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/game/view.ts server/tests/game/view.test.ts
git commit -m "Wrap engine PlayerView with per-slot presence as GameView"
```

---

## Task 6: `GameRegistry` — per-room connection set + broadcast

**Files:**
- Create: `server/src/game/registry.ts`
- Create: `server/tests/game/registry.test.ts`

Keeps the test surface minimal by accepting a structural `Sendable` interface rather than depending on `ws` in this file. The real `WebSocket` satisfies it; tests pass fakes.

- [ ] **Step 1: Write failing tests**

Create `server/tests/game/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { GameRegistry } from '../../src/game/registry';

function fakeConn(id: string) {
  const sent: unknown[] = [];
  const closes: Array<{ code: number; reason: string }> = [];
  return {
    id,
    sessionId: id,
    send: (msg: unknown) => sent.push(msg),
    close: (code: number, reason: string) => closes.push({ code, reason }),
    sent, closes,
  };
}

describe('GameRegistry', () => {
  it('adds and removes connections per room', () => {
    const reg = new GameRegistry();
    const a = fakeConn('a');
    const b = fakeConn('b');
    reg.add('room1', a);
    reg.add('room1', b);
    expect(reg.size('room1')).toBe(2);
    reg.remove('room1', a);
    expect(reg.size('room1')).toBe(1);
  });

  it('broadcast sends to every connection in a room', () => {
    const reg = new GameRegistry();
    const a = fakeConn('a');
    const b = fakeConn('b');
    reg.add('room1', a);
    reg.add('room1', b);
    reg.broadcast('room1', { type: 'ping' });
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
  });

  it('findBySession returns the single connection for a sessionId', () => {
    const reg = new GameRegistry();
    const a = fakeConn('alice');
    reg.add('r', a);
    expect(reg.findBySession('r', 'alice')).toBe(a);
    expect(reg.findBySession('r', 'bob')).toBeUndefined();
  });

  it('broadcastCloseAll calls close on every conn and empties rooms', () => {
    const reg = new GameRegistry();
    const a = fakeConn('a');
    const b = fakeConn('b');
    reg.add('r1', a);
    reg.add('r2', b);
    reg.broadcastCloseAll(1001, 'shutdown');
    expect(a.closes).toEqual([{ code: 1001, reason: 'shutdown' }]);
    expect(b.closes).toEqual([{ code: 1001, reason: 'shutdown' }]);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd server && npx vitest run tests/game/registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/game/registry.ts`**

```ts
export interface RegisteredConnection {
  sessionId: string;
  send(message: unknown): void;
  close(code: number, reason: string): void;
}

export class GameRegistry {
  private readonly rooms = new Map<string, Set<RegisteredConnection>>();

  add(roomId: string, conn: RegisteredConnection): void {
    let set = this.rooms.get(roomId);
    if (!set) { set = new Set(); this.rooms.set(roomId, set); }
    set.add(conn);
  }

  remove(roomId: string, conn: RegisteredConnection): void {
    const set = this.rooms.get(roomId);
    if (!set) return;
    set.delete(conn);
    if (set.size === 0) this.rooms.delete(roomId);
  }

  size(roomId: string): number {
    return this.rooms.get(roomId)?.size ?? 0;
  }

  findBySession(roomId: string, sessionId: string): RegisteredConnection | undefined {
    const set = this.rooms.get(roomId);
    if (!set) return undefined;
    for (const conn of set) if (conn.sessionId === sessionId) return conn;
    return undefined;
  }

  forEachInRoom(roomId: string, fn: (conn: RegisteredConnection) => void): void {
    const set = this.rooms.get(roomId);
    if (!set) return;
    for (const conn of set) fn(conn);
  }

  broadcast(roomId: string, message: unknown): void {
    this.forEachInRoom(roomId, (c) => c.send(message));
  }

  broadcastCloseAll(code: number, reason: string): void {
    for (const [roomId, set] of this.rooms) {
      for (const conn of set) conn.close(code, reason);
      set.clear();
      this.rooms.delete(roomId);
    }
  }

  allConnections(): RegisteredConnection[] {
    const out: RegisteredConnection[] = [];
    for (const set of this.rooms.values()) for (const c of set) out.push(c);
    return out;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd server && npx vitest run tests/game/registry.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/game/registry.ts server/tests/game/registry.test.ts
git commit -m "Add GameRegistry with per-room broadcast and close-all"
```

---

## Task 7: Pure dispatch — decide effects from a client message

**Files:**
- Create: `server/src/game/dispatch.ts`
- Create: `server/tests/game/dispatch.test.ts`

The dispatch function is pure: given a room, sessionId, and a validated message, it returns a list of effects. `connection.ts` (Task 10) runs them. This split keeps unit tests socket-free.

- [ ] **Step 1: Write failing tests**

Create `server/tests/game/dispatch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { dispatchMessage } from '../../src/game/dispatch';
import { makeRoom } from '../fixtures';
import { initializeGameState } from '../../src/room/lifecycle';
import type { ClientMessage } from '../../src/game/protocol';

function readyPlayingRoom(sessionIds: string[]) {
  const room = makeRoom();
  room.slots = sessionIds.map((sid, i) => ({
    kind: 'human' as const, sessionId: sid, name: sid, connected: true, joinedAt: i,
    graceDeadline: null, graceTimer: null, botControlled: false,
  }));
  room.config.maxPlayers = sessionIds.length;
  room.phase = 'playing';
  room.game = initializeGameState(room);
  return room;
}

describe('dispatchMessage', () => {
  it('rejects an action from a non-current player with actionError', () => {
    const room = readyPlayingRoom(['alice', 'bob']);
    const current = room.game!.players[room.game!.currentPlayerIndex]!.id;
    const other = current === 'alice' ? 'bob' : 'alice';
    const msg: ClientMessage = {
      type: 'action',
      action: { type: 'DISCARD', handIndex: 0, discardPileIndex: 0, targetPlayerIndex: 0 },
    };
    const effects = dispatchMessage(room, other, msg, { now: () => 0 });
    expect(effects).toEqual([
      { kind: 'sendTo', sessionId: other, message: { type: 'actionError', reason: 'notYourTurn', stateVersion: room.game!.stateVersion } },
    ]);
  });

  it('commits a legal action, bumps stateVersion, and emits broadcast', () => {
    const room = readyPlayingRoom(['alice', 'bob']);
    const current = room.game!.players[room.game!.currentPlayerIndex]!.id;
    const prevVersion = room.game!.stateVersion;
    const msg: ClientMessage = {
      type: 'action',
      action: { type: 'DISCARD', handIndex: 0, discardPileIndex: 0, targetPlayerIndex: room.game!.currentPlayerIndex },
    };
    const effects = dispatchMessage(room, current, msg, { now: () => 0 });
    const broadcast = effects.find((e) => e.kind === 'broadcastState');
    expect(broadcast).toBeDefined();
    expect(room.game!.stateVersion).toBe(prevVersion + 1);
  });

  it('broadcasts a chat after truncating and stripping control chars', () => {
    const room = readyPlayingRoom(['alice', 'bob']);
    const msg: ClientMessage = { type: 'chat', text: 'hi\u0000 there' };
    const effects = dispatchMessage(room, 'alice', msg, { now: () => 42 });
    expect(effects).toEqual([
      {
        kind: 'broadcastChat',
        chat: { type: 'chat', fromSlotIndex: 0, fromName: 'alice', text: 'hi there', sentAt: 42 },
      },
    ]);
  });

  it('rejects an action when room.phase is not playing', () => {
    const room = readyPlayingRoom(['alice', 'bob']);
    room.phase = 'finished';
    const current = room.game!.players[room.game!.currentPlayerIndex]!.id;
    const msg: ClientMessage = {
      type: 'action',
      action: { type: 'DISCARD', handIndex: 0, discardPileIndex: 0, targetPlayerIndex: room.game!.currentPlayerIndex },
    };
    const effects = dispatchMessage(room, current, msg, { now: () => 0 });
    expect(effects[0]).toMatchObject({ kind: 'sendTo', message: { type: 'actionError', reason: 'notPlaying' } });
  });

  it('rejects an action from a disconnected human', () => {
    const room = readyPlayingRoom(['alice', 'bob']);
    const current = room.game!.players[room.game!.currentPlayerIndex]!.id;
    const slotIndex = room.slots.findIndex((s) => s.kind === 'human' && s.sessionId === current);
    const slot = room.slots[slotIndex] as Extract<typeof room.slots[number], { kind: 'human' }>;
    slot.connected = false;
    const msg: ClientMessage = {
      type: 'action',
      action: { type: 'DISCARD', handIndex: 0, discardPileIndex: 0, targetPlayerIndex: room.game!.currentPlayerIndex },
    };
    const effects = dispatchMessage(room, current, msg, { now: () => 0 });
    expect(effects[0]).toMatchObject({ kind: 'sendTo', message: { type: 'actionError', reason: 'notConnected' } });
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd server && npx vitest run tests/game/dispatch.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/game/dispatch.ts`**

```ts
import { applyAction } from '@engine/engine';
import type { Room } from '../types';
import type { ClientMessage, ServerMessage } from './protocol';
import { slotIndexForPlayerId } from './mapping';

export type DispatchEffect =
  | { kind: 'sendTo'; sessionId: string; message: ServerMessage }
  | { kind: 'broadcastState' }
  | { kind: 'broadcastChat'; chat: Extract<ServerMessage, { type: 'chat' }> }
  | { kind: 'afterCommit' };

export interface DispatchDeps { now: () => number }

function sanitizeChat(text: string): string {
  return text.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200);
}

export function dispatchMessage(
  room: Room,
  sessionId: string,
  msg: ClientMessage,
  deps: DispatchDeps,
): DispatchEffect[] {
  if (msg.type === 'chat') {
    const slotIndex = slotIndexForPlayerId(room, sessionId);
    if (slotIndex < 0) return [];
    const slot = room.slots[slotIndex];
    if (!slot || slot.kind !== 'human') return [];
    const clean = sanitizeChat(msg.text);
    if (clean.length === 0) return [];
    return [{
      kind: 'broadcastChat',
      chat: { type: 'chat', fromSlotIndex: slotIndex, fromName: slot.name, text: clean, sentAt: deps.now() },
    }];
  }

  // action
  const stateVersion = room.game?.stateVersion ?? 0;
  if (room.phase !== 'playing' || !room.game) {
    return [{ kind: 'sendTo', sessionId, message: { type: 'actionError', reason: 'notPlaying', stateVersion } }];
  }
  const current = room.game.players[room.game.currentPlayerIndex];
  if (!current || current.id !== sessionId) {
    return [{ kind: 'sendTo', sessionId, message: { type: 'actionError', reason: 'notYourTurn', stateVersion } }];
  }
  const slotIndex = slotIndexForPlayerId(room, sessionId);
  const slot = room.slots[slotIndex];
  if (!slot || slot.kind !== 'human' || !slot.connected) {
    return [{ kind: 'sendTo', sessionId, message: { type: 'actionError', reason: 'notConnected', stateVersion } }];
  }
  const result = applyAction(room.game, msg.action);
  if (!result.ok) {
    return [{ kind: 'sendTo', sessionId, message: { type: 'actionError', reason: result.error, stateVersion } }];
  }
  room.game = result.state;
  return [{ kind: 'broadcastState' }, { kind: 'afterCommit' }];
}
```

- [ ] **Step 4: Run tests**

Run: `cd server && npx vitest run tests/game/dispatch.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/game/dispatch.ts server/tests/game/dispatch.test.ts
git commit -m "Dispatch client messages into engine actions or chat effects"
```

---

## Task 8: Grace timer module

**Files:**
- Create: `server/src/game/grace.ts`
- Create: `server/tests/game/grace.test.ts`

Per-slot 60 s timer. All mutation is synchronous and in-process. Exposes `startGrace`, `cancelGrace`, `clearAllGraceTimers` (imperative — no effect list; registry broadcast happens in the caller).

- [ ] **Step 1: Write failing tests**

Create `server/tests/game/grace.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { startGrace, cancelGrace, GRACE_MS } from '../../src/game/grace';
import { makeRoom } from '../fixtures';

function humanSlot(sessionId: string) {
  return {
    kind: 'human' as const, sessionId, name: sessionId, connected: false,
    joinedAt: 0, graceDeadline: null, graceTimer: null, botControlled: false,
  };
}

describe('grace', () => {
  it('arms a 60 s timer and populates graceDeadline', () => {
    vi.useFakeTimers();
    try {
      const room = makeRoom();
      room.phase = 'playing';
      room.slots = [humanSlot('alice'), humanSlot('bob')];
      const now = Date.now();
      startGrace(room, 0, { onExpire: () => {} });
      const slot = room.slots[0]!;
      expect(slot.kind).toBe('human');
      if (slot.kind !== 'human') throw new Error('unreachable');
      expect(slot.graceDeadline).toBe(now + GRACE_MS);
      expect(slot.graceTimer).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('fires onExpire after 60 s and flips botControlled true', () => {
    vi.useFakeTimers();
    try {
      const room = makeRoom();
      room.phase = 'playing';
      room.slots = [humanSlot('alice'), humanSlot('bob')];
      let expired = 0;
      startGrace(room, 0, { onExpire: () => { expired++; } });
      vi.advanceTimersByTime(59_999);
      expect(expired).toBe(0);
      vi.advanceTimersByTime(2);
      expect(expired).toBe(1);
      const slot = room.slots[0]!;
      if (slot.kind !== 'human') throw new Error('unreachable');
      expect(slot.botControlled).toBe(true);
      expect(slot.graceDeadline).toBeNull();
      expect(slot.graceTimer).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancelGrace clears the timer and never fires onExpire', () => {
    vi.useFakeTimers();
    try {
      const room = makeRoom();
      room.phase = 'playing';
      room.slots = [humanSlot('alice')];
      let expired = 0;
      startGrace(room, 0, { onExpire: () => { expired++; } });
      vi.advanceTimersByTime(30_000);
      cancelGrace(room, 0);
      vi.advanceTimersByTime(60_000);
      expect(expired).toBe(0);
      const slot = room.slots[0]!;
      if (slot.kind !== 'human') throw new Error('unreachable');
      expect(slot.graceDeadline).toBeNull();
      expect(slot.graceTimer).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('two concurrent timers do not interfere', () => {
    vi.useFakeTimers();
    try {
      const room = makeRoom();
      room.phase = 'playing';
      room.slots = [humanSlot('alice'), humanSlot('bob')];
      const fired: number[] = [];
      startGrace(room, 0, { onExpire: () => fired.push(0) });
      vi.advanceTimersByTime(30_000);
      startGrace(room, 1, { onExpire: () => fired.push(1) });
      vi.advanceTimersByTime(30_000);
      expect(fired).toEqual([0]);
      vi.advanceTimersByTime(30_000);
      expect(fired).toEqual([0, 1]);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd server && npx vitest run tests/game/grace.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/game/grace.ts`**

```ts
import type { Room } from '../types';

export const GRACE_MS = 60_000;

export interface StartGraceOpts {
  onExpire: () => void;
}

export function startGrace(room: Room, slotIndex: number, opts: StartGraceOpts): void {
  const slot = room.slots[slotIndex];
  if (!slot || slot.kind !== 'human') return;
  if (slot.graceTimer) clearTimeout(slot.graceTimer);
  slot.graceDeadline = Date.now() + GRACE_MS;
  slot.graceTimer = setTimeout(() => {
    slot.graceTimer = null;
    slot.graceDeadline = null;
    slot.botControlled = true;
    opts.onExpire();
  }, GRACE_MS);
}

export function cancelGrace(room: Room, slotIndex: number): void {
  const slot = room.slots[slotIndex];
  if (!slot || slot.kind !== 'human') return;
  if (slot.graceTimer) clearTimeout(slot.graceTimer);
  slot.graceTimer = null;
  slot.graceDeadline = null;
}

export function clearAllGraceTimers(room: Room): void {
  for (const slot of room.slots) {
    if (slot.kind === 'human' && slot.graceTimer) {
      clearTimeout(slot.graceTimer);
      slot.graceTimer = null;
      slot.graceDeadline = null;
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd server && npx vitest run tests/game/grace.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/game/grace.ts server/tests/game/grace.test.ts
git commit -m "Add per-slot 60s grace timer with expire and cancel"
```

---

## Task 9: Bot driver — `maybeRunBotTurn` + random legal action

**Files:**
- Create: `server/src/game/bot.ts`
- Create: `server/tests/game/bot.test.ts`

v1 picks the first legal action it finds: try stock to build, hand to build, discard to build, then DISCARD. Idempotent: second call while a move is pending is a no-op.

- [ ] **Step 1: Write failing tests**

Create `server/tests/game/bot.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { maybeRunBotTurn, BOT_MOVE_DELAY_MS } from '../../src/game/bot';
import { makeRoom } from '../fixtures';
import { initializeGameState } from '../../src/room/lifecycle';

function playingRoomAllAi() {
  const room = makeRoom();
  room.slots = [
    { kind: 'ai', botId: 'bot-a', difficulty: 'easy' },
    { kind: 'ai', botId: 'bot-b', difficulty: 'easy' },
  ];
  room.config.maxPlayers = 2;
  room.phase = 'playing';
  room.game = initializeGameState(room);
  return room;
}

describe('maybeRunBotTurn', () => {
  it('no-ops when room.phase is not playing', () => {
    vi.useFakeTimers();
    try {
      const room = playingRoomAllAi();
      room.phase = 'finished';
      let fired = 0;
      maybeRunBotTurn(room, { onAfterMove: () => fired++ });
      vi.advanceTimersByTime(BOT_MOVE_DELAY_MS + 100);
      expect(fired).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('no-ops when current seat is a connected human', () => {
    vi.useFakeTimers();
    try {
      const room = makeRoom();
      room.slots = [
        { kind: 'human', sessionId: 'a', name: 'A', connected: true, joinedAt: 0, graceDeadline: null, graceTimer: null, botControlled: false },
        { kind: 'human', sessionId: 'b', name: 'B', connected: true, joinedAt: 1, graceDeadline: null, graceTimer: null, botControlled: false },
      ];
      room.config.maxPlayers = 2;
      room.phase = 'playing';
      room.game = initializeGameState(room);
      let fired = 0;
      maybeRunBotTurn(room, { onAfterMove: () => fired++ });
      vi.advanceTimersByTime(BOT_MOVE_DELAY_MS + 100);
      expect(fired).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('schedules a bot move for an ai seat and bumps stateVersion', () => {
    vi.useFakeTimers();
    try {
      const room = playingRoomAllAi();
      const prev = room.game!.stateVersion;
      let fired = 0;
      maybeRunBotTurn(room, { onAfterMove: () => fired++ });
      vi.advanceTimersByTime(BOT_MOVE_DELAY_MS + 1);
      expect(fired).toBe(1);
      expect(room.game!.stateVersion).toBeGreaterThan(prev);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is idempotent: second call while pending is a no-op', () => {
    vi.useFakeTimers();
    try {
      const room = playingRoomAllAi();
      let fired = 0;
      maybeRunBotTurn(room, { onAfterMove: () => fired++ });
      maybeRunBotTurn(room, { onAfterMove: () => fired++ });
      vi.advanceTimersByTime(BOT_MOVE_DELAY_MS + 1);
      expect(fired).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('schedules a bot move for a botControlled human seat', () => {
    vi.useFakeTimers();
    try {
      const room = makeRoom();
      room.slots = [
        { kind: 'human', sessionId: 'a', name: 'A', connected: false, joinedAt: 0, graceDeadline: null, graceTimer: null, botControlled: true },
        { kind: 'ai', botId: 'bot-b', difficulty: 'easy' },
      ];
      room.config.maxPlayers = 2;
      room.phase = 'playing';
      room.game = initializeGameState(room);
      room.game!.currentPlayerIndex = 0; // force bot-controlled human to be current
      let fired = 0;
      maybeRunBotTurn(room, { onAfterMove: () => fired++ });
      vi.advanceTimersByTime(BOT_MOVE_DELAY_MS + 1);
      expect(fired).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `cd server && npx vitest run tests/game/bot.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/game/bot.ts`**

```ts
import type { Room } from '../types';
import type { GameAction, GameState } from '@engine/types';
import { BUILD_PILE_COUNT, DISCARD_PILE_COUNT } from '@engine/types';
import { applyAction } from '@engine/engine';
import { currentPlayerSlotIndex } from './mapping';

export const BOT_MOVE_DELAY_MS = 800;

export interface BotDeps {
  onAfterMove: () => void;
}

export function maybeRunBotTurn(room: Room, deps: BotDeps): void {
  if (room.phase !== 'playing' || !room.game) return;
  const slotIndex = currentPlayerSlotIndex(room);
  if (slotIndex < 0) return;
  const slot = room.slots[slotIndex];
  if (!slot) return;
  const isBotSeat =
    slot.kind === 'ai' ||
    (slot.kind === 'human' && slot.botControlled);
  if (!isBotSeat) return;
  if (room.botPending.has(slotIndex)) return;
  room.botPending.add(slotIndex);
  setTimeout(() => {
    room.botPending.delete(slotIndex);
    if (room.phase !== 'playing' || !room.game) return;
    if (currentPlayerSlotIndex(room) !== slotIndex) return;
    const action = pickRandomLegalAction(room.game);
    if (!action) return;
    const result = applyAction(room.game, action);
    if (!result.ok) return;
    room.game = result.state;
    deps.onAfterMove();
  }, BOT_MOVE_DELAY_MS);
}

export function pickRandomLegalAction(state: GameState): GameAction | null {
  const me = state.players[state.currentPlayerIndex];
  if (!me) return null;

  // Try PLAY_TO_BUILD from stock (highest priority — stock reduction wins).
  for (let bp = 0; bp < BUILD_PILE_COUNT; bp++) {
    const action: GameAction = {
      type: 'PLAY_TO_BUILD',
      source: { from: 'stock', playerIndex: state.currentPlayerIndex },
      buildPileIndex: bp,
    };
    if (applyAction(state, action).ok) return action;
    const asc: GameAction = { ...action, declaredDirection: 'asc' };
    if (applyAction(state, asc).ok) return asc;
    const desc: GameAction = { ...action, declaredDirection: 'desc' };
    if (applyAction(state, desc).ok) return desc;
  }

  // Try PLAY_TO_BUILD from hand.
  for (let h = 0; h < me.hand.length; h++) {
    for (let bp = 0; bp < BUILD_PILE_COUNT; bp++) {
      const action: GameAction = {
        type: 'PLAY_TO_BUILD',
        source: { from: 'hand', index: h },
        buildPileIndex: bp,
      };
      if (applyAction(state, action).ok) return action;
      const asc: GameAction = { ...action, declaredDirection: 'asc' };
      if (applyAction(state, asc).ok) return asc;
      const desc: GameAction = { ...action, declaredDirection: 'desc' };
      if (applyAction(state, desc).ok) return desc;
    }
  }

  // Try PLAY_TO_BUILD from own discards.
  for (let dp = 0; dp < DISCARD_PILE_COUNT; dp++) {
    for (let bp = 0; bp < BUILD_PILE_COUNT; bp++) {
      const action: GameAction = {
        type: 'PLAY_TO_BUILD',
        source: { from: 'discard', playerIndex: state.currentPlayerIndex, pileIndex: dp },
        buildPileIndex: bp,
      };
      if (applyAction(state, action).ok) return action;
    }
  }

  // Fallback: DISCARD first hand card to first discard pile.
  if (me.hand.length > 0) {
    return {
      type: 'DISCARD',
      handIndex: 0,
      discardPileIndex: 0,
      targetPlayerIndex: state.currentPlayerIndex,
    };
  }
  return null;
}
```

- [ ] **Step 4: Run tests**

Run: `cd server && npx vitest run tests/game/bot.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add server/src/game/bot.ts server/tests/game/bot.test.ts
git commit -m "Add bot driver with random legal move and idempotency guard"
```

---

## Task 10: `GameConnection` — per-socket lifecycle

**Files:**
- Create: `server/src/game/connection.ts`

Wires registry, dispatch, grace, bot, view, and heartbeat together. No unit test here — it's covered by the real-socket tests in Tasks 13–14. Unit-testing this directly would require mocking the entire `ws` surface; the integration tests are the right place.

- [ ] **Step 1: Implement `server/src/game/connection.ts`**

```ts
import type { WebSocket } from 'ws';
import type { RoomManager } from '../room/manager';
import type { Room } from '../types';
import type { GameRegistry, RegisteredConnection } from './registry';
import { ClientMessageSchema, MAX_CHAT_LEN, type ServerMessage } from './protocol';
import { dispatchMessage } from './dispatch';
import { buildGameView } from './view';
import { startGrace, cancelGrace } from './grace';
import { maybeRunBotTurn } from './bot';
import { logger } from '../logger';

const HEARTBEAT_MS = 25_000;
const HEARTBEAT_TIMEOUT_MS = 30_000;
const BACKPRESSURE_LIMIT = 256 * 1024;
const CHAT_RATE_LIMIT = { capacity: 5, refillPerMs: 5 / 10_000 }; // 5 msgs / 10 s
const MSG_RATE_LIMIT = { capacity: 20, refillPerMs: 10 / 1_000 }; // 10 sustained, burst 20

function takeToken(bucket: { tokens: number; lastRefill: number }, cfg: { capacity: number; refillPerMs: number }): boolean {
  const now = Date.now();
  bucket.tokens = Math.min(cfg.capacity, bucket.tokens + (now - bucket.lastRefill) * cfg.refillPerMs);
  bucket.lastRefill = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

export interface GameConnectionDeps {
  ws: WebSocket;
  room: Room;
  sessionId: string;
  slotIndex: number;
  manager: RoomManager;
  registry: GameRegistry;
}

export class GameConnection implements RegisteredConnection {
  readonly sessionId: string;
  private readonly ws: WebSocket;
  private readonly room: Room;
  private readonly slotIndex: number;
  private readonly manager: RoomManager;
  private readonly registry: GameRegistry;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatDeadline: NodeJS.Timeout | null = null;
  private closed = false;
  private readonly log = logger.child({ component: 'gameWs' });
  private readonly msgBucket = { tokens: MSG_RATE_LIMIT.capacity, lastRefill: Date.now() };
  private readonly chatBucket = { tokens: CHAT_RATE_LIMIT.capacity, lastRefill: Date.now() };

  constructor(deps: GameConnectionDeps) {
    this.ws = deps.ws;
    this.room = deps.room;
    this.sessionId = deps.sessionId;
    this.slotIndex = deps.slotIndex;
    this.manager = deps.manager;
    this.registry = deps.registry;
    this.attach();
  }

  send(message: unknown): void {
    if (this.closed) return;
    if (this.ws.bufferedAmount > BACKPRESSURE_LIMIT) {
      this.log.warn({ roomId: this.room.id, sessionId: this.sessionId, buffered: this.ws.bufferedAmount }, 'backpressureKill');
      this.close(1008, 'slow consumer');
      return;
    }
    this.ws.send(JSON.stringify(message));
  }

  close(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    try { this.ws.close(code, reason); } catch { /* ignore */ }
  }

  private attach(): void {
    const slot = this.room.slots[this.slotIndex];
    if (slot?.kind === 'human') {
      slot.connected = true;
      cancelGrace(this.room, this.slotIndex);
      if (slot.botControlled) slot.botControlled = false;
    }
    this.registry.add(this.room.id, this);
    this.log.info({ roomId: this.room.id, sessionId: this.sessionId, slotIndex: this.slotIndex }, 'attach');

    this.sendHello();
    this.broadcastState();
    this.startHeartbeat();

    this.ws.on('message', (raw) => this.handleMessage(raw));
    this.ws.on('pong', () => this.refreshHeartbeatDeadline());
    this.ws.on('close', (code, reason) => this.handleClose(code, reason.toString()));
    this.ws.on('error', (err) => { this.log.warn({ err }, 'wsError'); });
  }

  private sendHello(): void {
    if (!this.room.game) { this.close(1008, 'no game'); return; }
    const view = buildGameView(this.room, this.sessionId);
    const hello: ServerMessage = { type: 'hello', stateVersion: this.room.game.stateVersion, view };
    this.send(hello);
  }

  private broadcastState(): void {
    if (!this.room.game) return;
    const stateVersion = this.room.game.stateVersion;
    this.registry.forEachInRoom(this.room.id, (conn) => {
      try {
        const view = buildGameView(this.room, conn.sessionId);
        const msg: ServerMessage = { type: 'state', stateVersion, view };
        conn.send(msg);
      } catch (err) {
        this.log.warn({ err, sessionId: conn.sessionId }, 'buildGameView failed during broadcast');
      }
    });
  }

  private broadcastChat(chat: Extract<ServerMessage, { type: 'chat' }>): void {
    this.registry.broadcast(this.room.id, chat);
  }

  private handleMessage(raw: unknown): void {
    if (!takeToken(this.msgBucket, MSG_RATE_LIMIT)) {
      this.log.warn({ sessionId: this.sessionId }, 'rateLimit');
      this.close(1008, 'rate limit');
      return;
    }
    let text: string;
    if (typeof raw === 'string') text = raw;
    else if (raw instanceof Buffer) text = raw.toString('utf-8');
    else { this.close(1008, 'bad frame'); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { this.close(1008, 'bad json'); return; }
    const check = ClientMessageSchema.safeParse(parsed);
    if (!check.success) { this.close(1008, 'bad message'); return; }
    const msg = check.data;
    if (msg.type === 'chat') {
      if (!takeToken(this.chatBucket, CHAT_RATE_LIMIT)) return;
      if (msg.text.length > MAX_CHAT_LEN) return;
    }
    const effects = dispatchMessage(this.room, this.sessionId, msg, { now: () => Date.now() });
    for (const e of effects) {
      if (e.kind === 'sendTo') {
        const conn = this.registry.findBySession(this.room.id, e.sessionId);
        if (conn) conn.send(e.message);
      } else if (e.kind === 'broadcastState') {
        this.broadcastState();
      } else if (e.kind === 'broadcastChat') {
        this.broadcastChat(e.chat);
      } else if (e.kind === 'afterCommit') {
        this.onAfterCommit();
      }
    }
  }

  private onAfterCommit(): void {
    if (this.room.game && this.room.game.phase === 'finished') {
      const stateVersion = this.room.game.stateVersion;
      this.registry.forEachInRoom(this.room.id, (conn) => {
        try {
          const view = buildGameView(this.room, conn.sessionId);
          const msg: ServerMessage = { type: 'gameEnded', stateVersion, view, reason: 'winner' };
          conn.send(msg);
        } catch { /* ignore */ }
      });
      this.manager.finishGame(this.room.id, 'winner');
      setTimeout(() => {
        this.registry.forEachInRoom(this.room.id, (conn) => conn.close(4005, 'game ended'));
      }, 150);
      return;
    }
    maybeRunBotTurn(this.room, {
      onAfterMove: () => {
        this.broadcastState();
        this.onAfterCommit();
      },
    });
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      try { this.ws.ping(); } catch { /* ignore */ }
      if (this.heartbeatDeadline) clearTimeout(this.heartbeatDeadline);
      this.heartbeatDeadline = setTimeout(() => {
        this.log.warn({ sessionId: this.sessionId }, 'heartbeatTimeout');
        try { this.ws.terminate(); } catch { /* ignore */ }
      }, HEARTBEAT_TIMEOUT_MS);
    }, HEARTBEAT_MS);
  }

  private refreshHeartbeatDeadline(): void {
    if (this.heartbeatDeadline) { clearTimeout(this.heartbeatDeadline); this.heartbeatDeadline = null; }
  }

  private handleClose(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.heartbeatDeadline) { clearTimeout(this.heartbeatDeadline); this.heartbeatDeadline = null; }
    this.registry.remove(this.room.id, this);
    this.log.info({ sessionId: this.sessionId, code, reason }, 'detach');

    const slot = this.room.slots[this.slotIndex];
    if (!slot || slot.kind !== 'human') return;
    slot.connected = false;

    if (this.room.phase === 'playing') {
      startGrace(this.room, this.slotIndex, {
        onExpire: () => {
          this.log.info({ sessionId: this.sessionId }, 'graceExpire');
          this.broadcastState();
          maybeRunBotTurn(this.room, {
            onAfterMove: () => { this.broadcastState(); this.onAfterCommit(); },
          });
        },
      });
    }
    this.broadcastState();
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd server && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/game/connection.ts
git commit -m "Add GameConnection wiring heartbeat dispatch grace and bot"
```

---

## Task 11: Handshake (HTTP Upgrade handler)

**Files:**
- Create: `server/src/game/handshake.ts`

- [ ] **Step 1: Implement `server/src/game/handshake.ts`**

```ts
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { RoomManager } from '../room/manager';
import type { GameRegistry } from './registry';
import { GameConnection } from './connection';
import { MAX_MESSAGE_BYTES } from './protocol';
import { logger } from '../logger';

const PATH_RE = /^\/rooms\/([^/]+)\/game$/;

export interface HandshakeDeps {
  manager: RoomManager;
  registry: GameRegistry;
  corsOrigin: string;
}

export function createGameUpgradeHandler(deps: HandshakeDeps): (req: IncomingMessage, socket: Duplex, head: Buffer) => void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const log = logger.child({ component: 'gameWs.handshake' });

  return (req, socket, head) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const match = PATH_RE.exec(url.pathname);
      if (!match) { socket.destroy(); return; }
      const roomId = decodeURIComponent(match[1]!);

      const origin = req.headers.origin;
      if (deps.corsOrigin !== '*' && (!origin || origin !== deps.corsOrigin)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      const room = deps.manager.get(roomId);
      const mappedRoomId = deps.manager.sessionRoomId(sessionId);
      const valid = room && mappedRoomId === roomId && room.phase === 'playing';

      if (!valid) {
        wss.handleUpgrade(req, socket, head, (ws) => ws.close(4003, 'invalid session'));
        return;
      }

      const slotIndex = room!.slots.findIndex((s) => s.kind === 'human' && s.sessionId === sessionId);
      if (slotIndex < 0) {
        wss.handleUpgrade(req, socket, head, (ws) => ws.close(4003, 'no slot'));
        return;
      }

      const existing = deps.registry.findBySession(roomId, sessionId);
      if (existing) existing.close(4004, 'duplicate session');

      wss.handleUpgrade(req, socket, head, (ws) => {
        new GameConnection({
          ws, room: room!, sessionId, slotIndex,
          manager: deps.manager, registry: deps.registry,
        });
      });
    } catch (err) {
      log.error({ err }, 'upgradeError');
      try { socket.destroy(); } catch { /* ignore */ }
    }
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd server && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add server/src/game/handshake.ts
git commit -m "Add HTTP upgrade handler with origin session and duplicate guards"
```

---

## Task 12: Wire game layer into `index.ts` and shutdown

**Files:**
- Modify: `server/src/shutdown.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Extend `installShutdown` to sweep game sockets and slot timers**

Replace `server/src/shutdown.ts` with:

```ts
import type { Server } from 'node:http';
import type { LobbyStreamRegistry } from './sse/registry';
import type { GameRegistry } from './game/registry';
import type { RoomManager } from './room/manager';
import { logger } from './logger';

export interface ShutdownOptions {
  httpServer: Server;
  registry?: LobbyStreamRegistry;
  gameRegistry?: GameRegistry;
  roomManager?: RoomManager;
  drainMs?: number;
}

export function installShutdown(opts: ShutdownOptions): (code: number) => Promise<void> {
  let inProgress = false;

  async function shutdown(code: number): Promise<void> {
    if (inProgress) return;
    inProgress = true;
    logger.info({ code }, 'shutdown starting');

    await new Promise<void>((resolve) => opts.httpServer.close(() => resolve()));

    if (opts.gameRegistry) {
      opts.gameRegistry.broadcastCloseAll(1001, 'shutdown');
    }

    if (opts.roomManager) {
      for (const room of opts.roomManager.allRooms()) {
        if (room.idleTimer) { clearTimeout(room.idleTimer); room.idleTimer = null; }
        if (room.cleanupTimer) { clearTimeout(room.cleanupTimer); room.cleanupTimer = null; }
        for (const slot of room.slots) {
          if (slot.kind === 'human' && slot.graceTimer) {
            clearTimeout(slot.graceTimer);
            slot.graceTimer = null;
            slot.graceDeadline = null;
          }
        }
      }
    }

    const drain = opts.drainMs ?? 5_000;
    await new Promise((r) => setTimeout(r, drain));

    logger.info({ code }, 'shutdown complete');
    process.exit(code);
  }

  process.on('SIGTERM', () => void shutdown(0));
  process.on('SIGINT', () => void shutdown(0));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    void shutdown(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'unhandled rejection');
    void shutdown(1);
  });

  return shutdown;
}
```

- [ ] **Step 2: Expose `allRooms()` on `RoomManager`**

In `server/src/room/manager.ts`, add a public getter below `stats()`:

```ts
allRooms(): Room[] { return [...this.rooms.values()]; }
```

- [ ] **Step 3: Wire the game WS in `server/src/index.ts`**

Replace the file with:

```ts
import { config } from './config';
import { logger } from './logger';
import { RoomManager } from './room/manager';
import { LobbyStreamRegistry } from './sse/registry';
import { buildHttpServer, mountRoutes } from './http/server';
import { startStatsTicker } from './stats';
import { installShutdown } from './shutdown';
import { GameRegistry } from './game/registry';
import { createGameUpgradeHandler } from './game/handshake';

function main(): void {
  const roomManager = new RoomManager();
  const registry = new LobbyStreamRegistry();
  const gameRegistry = new GameRegistry();

  roomManager.events.on('roomAdded', (e) => registry.publish(e));
  roomManager.events.on('roomUpdated', (e) => registry.publish(e));
  roomManager.events.on('roomRemoved', (e) => registry.publish(e));

  const { httpServer, router } = buildHttpServer({
    roomManager,
    corsOrigin: config.corsOrigin,
  });
  mountRoutes(router, roomManager, { registry });
  const stopStats = startStatsTicker(roomManager, registry);

  const upgrade = createGameUpgradeHandler({
    manager: roomManager, registry: gameRegistry, corsOrigin: config.corsOrigin,
  });
  httpServer.on('upgrade', upgrade);

  installShutdown({ httpServer, registry, gameRegistry, roomManager });

  httpServer.listen(config.httpPort, () => {
    logger.info({ port: config.httpPort }, 'server listening');
  });

  process.on('exit', () => stopStats());
}

main();
```

- [ ] **Step 4: Typecheck + full suite**

Run: `cd server && npm run typecheck`
Expected: no errors.

Run: `cd server && npm test`
Expected: all tests from Tasks 1–9 pass; no prior tests regress.

- [ ] **Step 5: Commit**

```bash
git add server/src/shutdown.ts server/src/room/manager.ts server/src/index.ts
git commit -m "Wire game WebSocket upgrade and shutdown sweep"
```

---

## Task 13: Integration test — handshake

**Files:**
- Create: `server/tests/game/handshake.test.ts`

Uses real sockets against `httpServer.listen(0)`.

- [ ] **Step 1: Write failing integration test**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
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

async function startHarness(): Promise<Harness> {
  const mgr = new RoomManager();
  const registry = new LobbyStreamRegistry();
  const gameRegistry = new GameRegistry();
  const { httpServer, router } = buildHttpServer({ roomManager: mgr, corsOrigin: '*' });
  mountRoutes(router, mgr, { registry });
  httpServer.on('upgrade', createGameUpgradeHandler({ manager: mgr, registry: gameRegistry, corsOrigin: '*' }));
  await new Promise<void>((r) => httpServer.listen(0, r));
  const { port } = httpServer.address() as AddressInfo;
  return {
    mgr, registry, gameRegistry,
    base: `http://127.0.0.1:${port}`, port, wsBase: `ws://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => httpServer.close(() => r())),
  };
}

async function startGameAndGetRoomId(h: Harness): Promise<{ roomId: string; host: string; guest: string }> {
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
  return { roomId, host: 'host', guest: 'guest' };
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
});
```

- [ ] **Step 2: Run, confirm 3 passing**

Run: `cd server && npx vitest run tests/game/handshake.test.ts`
Expected: 3 passing.

- [ ] **Step 3: Commit**

```bash
git add server/tests/game/handshake.test.ts
git commit -m "Test game WS handshake hello path and close codes"
```

---

## Task 14: Integration test — full-flow game WS

**Files:**
- Create: `server/tests/game/fullFlow.test.ts`

Two connected clients, real actions, chat, grace window, reconnect.

- [ ] **Step 1: Write failing integration test**

```ts
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
  httpServer.on('upgrade', createGameUpgradeHandler({ manager: mgr, registry: gameRegistry, corsOrigin: '*' }));
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
```

- [ ] **Step 2: Run, confirm passing**

Run: `cd server && npx vitest run tests/game/fullFlow.test.ts`
Expected: 1 passing. (Runtime up to ~5 s.)

- [ ] **Step 3: Run the entire server suite as a regression guard**

Run: `cd server && npm test`
Expected: every test passes (previous 70 + new 12 from Tasks 3, 4, 5, 6, 7, 8, 9, 13, 14).

- [ ] **Step 4: Commit**

```bash
git add server/tests/game/fullFlow.test.ts
git commit -m "Test end-to-end game WS flow with chat and grace presence"
```

---

## Task 15: Shared client-side protocol types

**Files:**
- Create: `src/lib/net/protocol.ts`

Mirrors server types but imports only the shapes the client needs. Kept in a separate file so the client doesn't import from `server/`.

- [ ] **Step 1: Implement `src/lib/net/protocol.ts`**

```ts
import type { GameAction, GameState, PlayerState } from '@/lib/game/types';

export interface OpponentView {
  id: string;
  name: string;
  handCount: number;
  stockCount: number;
  stockTop: { id: string; value: PlayerState['hand'][number]['value'] } | null;
  discardPiles: { id: string; value: PlayerState['hand'][number]['value'] }[][];
}

export interface PlayerView {
  config: GameState['config'];
  phase: GameState['phase'];
  turnPhase: GameState['turnPhase'];
  currentPlayerIndex: number;
  winningTeamIndex: number | null;
  stateVersion: number;
  buildPiles: GameState['buildPiles'];
  drawPileCount: number;
  youIndex: number;
  you: PlayerState;
  opponents: OpponentView[];
}

export interface GameViewSeat {
  slotIndex: number;
  kind: 'human' | 'ai' | 'locked' | 'open';
  name: string | null;
  connected: boolean;
  graceDeadline: number | null;
  botControlled: boolean;
}

export interface GameView {
  view: PlayerView;
  seats: GameViewSeat[];
}

export type ClientMessage =
  | { type: 'action'; action: GameAction }
  | { type: 'chat'; text: string };

export type ServerMessage =
  | { type: 'hello';       stateVersion: number; view: GameView }
  | { type: 'state';       stateVersion: number; view: GameView }
  | { type: 'actionError'; reason: string; stateVersion: number }
  | { type: 'chat';        fromSlotIndex: number; fromName: string; text: string; sentAt: number }
  | { type: 'gameEnded';   stateVersion: number; view: GameView; reason: 'winner' | 'abandoned' };

export interface ChatEntry {
  fromSlotIndex: number;
  fromName: string;
  text: string;
  sentAt: number;
}

export const TERMINAL_CLOSE_CODES = new Set([4002, 4003, 4004, 4005]);
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/net/protocol.ts
git commit -m "Mirror game WS protocol types on the client"
```

---

## Task 16: `useGameSocket` hook

**Files:**
- Create: `src/lib/net/useGameSocket.ts`
- Create: `src/lib/net/useGameSocket.test.ts`

Exposes `sendAction`, `sendChat`, `view`, `stateVersion`, `status`, `lastError`, `chat`. Keeps a send queue flushed on open. Reconnects with exponential backoff + jitter; refuses to retry on terminal codes.

- [ ] **Step 1: Write a failing unit test for backoff computation**

```ts
// src/lib/net/useGameSocket.test.ts
import { describe, it, expect } from 'vitest';
import { computeReconnectDelay, shouldReconnect } from './useGameSocket';

describe('useGameSocket helpers', () => {
  it('caps backoff at 10 s', () => {
    expect(computeReconnectDelay(0, () => 1)).toBeLessThanOrEqual(10_000);
    expect(computeReconnectDelay(1, () => 1)).toBeLessThanOrEqual(10_000);
    expect(computeReconnectDelay(6, () => 1)).toBe(10_000);
  });

  it('applies [0.5, 1.0] jitter', () => {
    const mid = computeReconnectDelay(1, () => 0.5);
    expect(mid).toBe(Math.round(1000 * 0.75)); // 500 * 2^1 * (0.5 + 0.5/2)
  });

  it('does not reconnect on terminal codes', () => {
    for (const code of [4002, 4003, 4004, 4005]) expect(shouldReconnect(code)).toBe(false);
    for (const code of [1001, 1006, 1011]) expect(shouldReconnect(code)).toBe(true);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npx vitest run src/lib/net/useGameSocket.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/net/useGameSocket.ts`**

```ts
'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { GameAction } from '@/lib/game/types';
import type { ChatEntry, ClientMessage, GameView, ServerMessage } from './protocol';
import { TERMINAL_CLOSE_CODES } from './protocol';

export function computeReconnectDelay(attempt: number, rand: () => number = Math.random): number {
  const base = Math.min(10_000, 500 * Math.pow(2, attempt));
  const jitter = 0.5 + rand() / 2;
  return Math.round(base * jitter);
}

export function shouldReconnect(code: number): boolean {
  return !TERMINAL_CLOSE_CODES.has(code);
}

export type GameSocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface GameSocket {
  view: GameView | null;
  stateVersion: number;
  status: GameSocketStatus;
  lastError: { code: number; reason: string } | null;
  sendAction: (action: GameAction) => void;
  sendChat: (text: string) => void;
  chat: ChatEntry[];
}

const OUTBOUND_CAP = 32;
const CHAT_RING_CAP = 50;

export function useGameSocket(roomId: string, sessionId: string): GameSocket {
  const [view, setView] = useState<GameView | null>(null);
  const [stateVersion, setStateVersion] = useState(0);
  const [status, setStatus] = useState<GameSocketStatus>('connecting');
  const [lastError, setLastError] = useState<{ code: number; reason: string } | null>(null);
  const [chat, setChat] = useState<ChatEntry[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const outboundRef = useRef<ClientMessage[]>([]);
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    const base = (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_GAME_WS_URL)
      || (typeof window !== 'undefined' ? `ws://${window.location.host}` : '');
    const url = `${base}/rooms/${encodeURIComponent(roomId)}/game?sessionId=${encodeURIComponent(sessionId)}`;
    setStatus((prev) => (prev === 'closed' ? prev : (attemptRef.current === 0 ? 'connecting' : 'reconnecting')));
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      attemptRef.current = 0;
      setStatus('open');
      for (const msg of outboundRef.current) ws.send(JSON.stringify(msg));
      outboundRef.current = [];
    };

    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try { msg = JSON.parse(ev.data as string) as ServerMessage; } catch { return; }
      switch (msg.type) {
        case 'hello':
        case 'state':
        case 'gameEnded':
          setView(msg.view);
          setStateVersion(msg.stateVersion);
          break;
        case 'actionError':
          setLastError({ code: 0, reason: msg.reason });
          break;
        case 'chat':
          setChat((prev) => {
            const next = [...prev, { fromSlotIndex: msg.fromSlotIndex, fromName: msg.fromName, text: msg.text, sentAt: msg.sentAt }];
            return next.length > CHAT_RING_CAP ? next.slice(next.length - CHAT_RING_CAP) : next;
          });
          break;
      }
    };

    ws.onclose = (ev) => {
      wsRef.current = null;
      setLastError({ code: ev.code, reason: ev.reason });
      if (!shouldReconnect(ev.code)) { setStatus('closed'); return; }
      const delay = computeReconnectDelay(attemptRef.current);
      attemptRef.current += 1;
      setStatus('reconnecting');
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => { /* onclose will follow */ };
  }, [roomId, sessionId]);

  useEffect(() => {
    connect();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && wsRef.current?.readyState !== WebSocket.OPEN) {
        if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
        attemptRef.current = 0;
        connect();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) { try { ws.close(1000); } catch { /* ignore */ } }
    };
  }, [connect]);

  const enqueue = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(msg)); return; }
    if (outboundRef.current.length >= OUTBOUND_CAP) outboundRef.current.shift();
    outboundRef.current.push(msg);
  }, []);

  const sendAction = useCallback((action: GameAction) => { enqueue({ type: 'action', action }); }, [enqueue]);
  const sendChat = useCallback((text: string) => { enqueue({ type: 'chat', text }); }, [enqueue]);

  return { view, stateVersion, status, lastError, sendAction, sendChat, chat };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/net/useGameSocket.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Full main-app suite regression**

Run: `npx vitest run`
Expected: all prior 60 tests still pass + 3 new.

- [ ] **Step 6: Commit**

```bash
git add src/lib/net/useGameSocket.ts src/lib/net/useGameSocket.test.ts
git commit -m "Add useGameSocket hook with backoff reconnect and send queue"
```

---

## Task 17: Carry hot-seat demo to `/local`

**Files:**
- Create: `src/app/local/page.tsx`
- Modify: `src/app/page.tsx` (strip game, keep as neutral landing stub until lobby page lands in Section 4 client integration)

- [ ] **Step 1: Copy the existing `Home` component to `/local`**

Move everything inside `src/app/page.tsx` (including `'use client'` and imports) into a new file `src/app/local/page.tsx`. Rename the default export from `Home` to `LocalHome`.

- [ ] **Step 2: Replace `src/app/page.tsx` with a minimal redirect to `/local`**

```tsx
import Link from 'next/link';

export default function Landing() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="space-y-4 text-center">
        <h1 className="text-2xl">Skip-Bo</h1>
        <p><Link className="underline" href="/local">Play hot-seat (local)</Link></p>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Typecheck + test**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npx vitest run`
Expected: all tests pass. (Component tests, if any, don't depend on the page file.)

- [ ] **Step 4: Commit**

```bash
git add src/app/local/page.tsx src/app/page.tsx
git commit -m "Move hot-seat demo to /local and stub landing page"
```

---

## Task 18: Networked game route at `/rooms/[roomId]`

**Files:**
- Create: `src/app/rooms/[roomId]/page.tsx`

Minimal v1: renders `useGameSocket` state as a read-only view of the current turn + a seat summary. The full Seat/TableCenter refactor to consume `GameView` can land in a follow-up — this page is a smoke test that the hook + WS + server round-trip all work.

- [ ] **Step 1: Implement the page**

```tsx
'use client';

import { useEffect, useState, use } from 'react';
import { useGameSocket } from '@/lib/net/useGameSocket';

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

export default function NetworkedRoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params);
  const sessionId = useSessionId();
  const socket = useGameSocket(roomId, sessionId ?? '');

  if (!sessionId) return <main className="p-8">Loading session...</main>;
  if (socket.status === 'closed') {
    return <main className="p-8">Connection closed: {socket.lastError?.reason ?? 'unknown'}.</main>;
  }
  if (!socket.view) return <main className="p-8">Connecting to game...</main>;

  return (
    <main className="p-4 space-y-4">
      <header className="flex gap-4 text-sm">
        <span>room {roomId}</span>
        <span>status {socket.status}</span>
        <span>v{socket.stateVersion}</span>
        <span>turn: slot {socket.view.view.currentPlayerIndex}</span>
      </header>
      <section>
        <h2 className="font-semibold mb-2">Seats</h2>
        <ul className="space-y-1">
          {socket.view.seats.map((s) => (
            <li key={s.slotIndex}>
              #{s.slotIndex} {s.kind} {s.name ?? '-'} {s.connected ? 'online' : 'offline'}
              {s.botControlled ? ' (bot)' : ''}
              {s.graceDeadline ? ` grace-${Math.max(0, Math.round((s.graceDeadline - Date.now()) / 1000))}s` : ''}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/rooms/[roomId]/page.tsx
git commit -m "Add networked /rooms/roomId page consuming useGameSocket"
```

---

## Task 19: Browser smoke test with Playwright MCP

**Files:** none — manual verification step recorded in progress notes.

Per `CLAUDE.md`: any change affecting layout needs a Playwright snapshot at 390×844 and 1280×800. Tasks 17–18 are both layout-adjacent.

- [ ] **Step 1: Start the dev server + game server in two terminals**

Terminal A: `cd server && npm run dev`
Terminal B: `npm run dev`

- [ ] **Step 2: Screenshot `/local` at mobile and desktop**

Via Playwright MCP: `browser_resize` to 390×844, `browser_navigate` `http://localhost:3000/local`, `browser_take_screenshot`. Then 1280×800, repeat.

Expected: hot-seat game renders identically to the pre-split state (no regression).

- [ ] **Step 3: Screenshot `/rooms/anything` to confirm connection UI**

`browser_navigate` `http://localhost:3000/rooms/does-not-exist`. Expected: shows "Connection closed" — terminal close from 4003 invalid session.

- [ ] **Step 4: Commit progress note**

Append to `docs/design-session-progress.md` under Section 3 a one-line "verified hot-seat and networked routes render in mobile and desktop viewports".

```bash
git add docs/design-session-progress.md
git commit -m "Note Section 3 hot-seat and networked route smoke screenshots"
```

---

## Task 20: Update CLAUDE.md status snapshot

**Files:**
- Modify: `CLAUDE.md`

Refresh the status snapshot so follow-on sessions know Section 3 is shipped.

- [ ] **Step 1: Edit `CLAUDE.md`**

In the `🔖 Where we left off` block, replace the current body with:

```
Section 3 (game WebSocket) shipped as `server/src/game/`: handshake + per-socket lifecycle + grace + bot + dispatch + registry. Client hook `src/lib/net/useGameSocket.ts` consumes per-socket `GameView` broadcasts; `/local` is the hot-seat demo, `/rooms/[roomId]` the networked game route. Next: brainstorm Section 5 (AI bots — strategy layer on top of the random-legal stub) or Section 7 (AWS deploy). Run `cd server && npm test` for server suite; `npx vitest run` for main-app suite. Pick up via `docs/design-session-progress.md`.
```

In the `Status snapshot` list, replace the `Networking — game WebSocket + client hook` bullet with:

```
- **Networking — game WebSocket + client hook (done):** `server/src/game/` adds raw-`ws` upgrade handler, per-socket `GameConnection`, `GameRegistry`, pure dispatch, per-slot 60 s grace, bot takeover (random legal move stub), full-flow integration tests. Client `useGameSocket` hook handles exponential backoff, terminal-code-aware reconnect, visibility-driven resume, bounded send queue. Hot-seat demo moved to `/local`; `/rooms/[roomId]` renders networked state.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "Refresh status snapshot to reflect shipped Section 3"
```

---

## Self-review notes (for the implementer)

Before marking this plan complete, confirm:

1. **All spec decisions locked in the table (Q1a–Q8)** are covered: grace behavior (Task 8), `GameView` shape (Task 5), chat (Tasks 3, 10), WS endpoint + `/rooms/:roomId/game` path (Task 11), action validation (Task 7), hybrid unit + integration tests (Tasks 3–9 unit, Tasks 13–14 integration), `hello` initial sync (Task 10), presence signals via seats (Task 5).
2. **Close codes exercised:** 4003 and 4004 in Task 13. 1001 path is verified by the shutdown change in Task 12 but is not exercised in tests — a follow-up test is acceptable to leave open; spec requires the capability, not a test.
3. **Invariants** from spec §Invariants: registry-to-slot pairing (Task 10 attach/close), grace timer implications (Task 8), `botControlled` triad (Tasks 8 + 10), `botPending` idempotency (Task 9), stateVersion monotonicity (implicit via engine; dispatch and broadcast only read `room.game.stateVersion`).
4. **Section 4 follow-ups closed:** #2 (double roomRemoved) in Task 2, #3 (finishGame clearIdleTimer) in Task 2. #10 (missing root `.dockerignore`) and others remain open — out of scope for this plan.
5. **Commit style:** every task ends with one `git commit` and one imperative single-line subject under 75 chars. No task bundles multiple logical changes.

If any of the above fails on execution, fix in place rather than deferring — the plan is authoritative, but the spec takes precedence when they disagree.
