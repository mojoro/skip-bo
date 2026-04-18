# Networked Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the full Skip-Bo game UI into `/rooms/[roomId]` (today only a debug view) by extracting a shared `Board` component from `/local` that consumes the networked wire shape (`PlayerView` + `GameViewSeat[]`). Add a server-driven rematch flow with a win modal CTA that creates a new pre-seated room and broadcasts the link.

**Architecture:** One presentational `Board` component, two drivers. `/local` adapts its local engine state to the wire shape via a pure `engineStateToView` function and dispatches synchronously. `/rooms/[roomId]` passes `socket.view` straight through and dispatches via `socket.sendAction` (server-authoritative). Rematch is implemented on the server by cloning the finished room's config, pre-seating every human at their original slot with `botControlled: true`, migrating their `sessionIndex` entry, starting the game immediately, and broadcasting `rematchReady { newRoomId }` to every connected socket. First human to attach claims host via the existing `migrateHostAwayFromBot` path.

**Tech Stack:** Next.js 16 App Router (Turbopack), React 19, TypeScript strict, Tailwind 4, Vitest, raw `ws@8`, Zod for server-side schema parsing. No DnD library (custom stack in `src/lib/dnd/`).

**Spec:** `docs/superpowers/specs/2026-04-18-networked-board-design.md`. Read it before starting — this plan executes its decisions.

---

## Dependency Graph and Parallel Execution

```
Phase 0 (serial):          [Task 0.1]
                              │
                              ├──────────┬──────────┬──────────┬──────────┐
                              ▼          ▼          ▼          ▼          ▼
Phase 1 (parallel, 5):   [Task 1.1] [Task 1.2] [Task 1.3] [Task 1.4] [Task 1.5]
                              │          │          │          │          │
                              │          │          └─────┬────┘          │
                              │          │                ▼               │
Phase 2 (serial):             │          │          [Task 2.1]            │
                              │          │                │               │
                              ├──────────┼────────────────┘               │
                              ▼          │                                 │
Phase 3 (parallel, 3):   [Task 3.1, 3.2, 3.3 — all need 1.1]              │
                                         │                                 │
                                         ▼                                 │
Phase 4 (serial):                   [Task 4.1 — needs 3.1, 3.2, 3.3]      │
                                         │                                 │
                                         ├─────────────────────────────────┤
                                         ▼                                 ▼
Phase 5 (parallel, 2):              [Task 5.1]                        [Task 5.2]
                                         │                                 │
                                         └─────────────────┬───────────────┘
                                                           ▼
Phase 6 (serial):                                     [Task 6.1]
```

**Subagent dispatch order:**

1. Dispatch Task 0.1 alone. Wait for commit.
2. Dispatch Tasks 1.1, 1.2, 1.3, 1.4, 1.5 in parallel. Wait for all five commits.
3. Dispatch Task 2.1 alone. Wait for commit.
4. Dispatch Tasks 3.1, 3.2, 3.3 in parallel. Wait for all three commits.
5. Dispatch Task 4.1 alone. Wait for commit.
6. Dispatch Tasks 5.1, 5.2 in parallel. Wait for both commits.
7. Dispatch Task 6.1 alone. Done.

**File ownership by task (no two parallel tasks touch the same file):**

- Task 0.1: `src/lib/net/protocol.ts`, `server/src/game/protocol.ts`
- Task 1.1: `src/lib/view/seat.ts` (new), `src/lib/view/seat.test.ts` (new)
- Task 1.2: `src/lib/view/fromEngine.ts` (new), `src/lib/view/fromEngine.test.ts` (new)
- Task 1.3: `server/src/game/registry.ts`, `server/tests/game/registry.test.ts`
- Task 1.4: `server/src/room/manager.ts`, `server/tests/room/manager.test.ts`
- Task 1.5: `src/lib/net/useGameSocket.ts`, `src/lib/net/useGameSocket.test.ts`
- Task 2.1: `server/src/game/dispatch.ts`, `server/src/game/connection.ts`, `server/tests/game/rematch.test.ts` (new), `server/tests/game/dispatch.test.ts`
- Task 3.1: `src/components/WinModal.tsx` (new)
- Task 3.2: `src/components/Seat.tsx`
- Task 3.3: `src/components/MobileBoard.tsx`, `src/components/MobileOpponentStrip.tsx`
- Task 4.1: `src/components/Board.tsx` (new), `src/components/TableCenter.tsx`
- Task 5.1: `src/app/rooms/[roomId]/page.tsx`
- Task 5.2: `src/app/local/page.tsx`
- Task 6.1: `src/components/Seat.tsx`, `src/components/MobileBoard.tsx`

---

## Project commands (run from repo root)

- Root app tests: `npm test` (Vitest).
- Root typecheck: `npx tsc --noEmit`.
  - Note: root `tsc --noEmit` still flags `@engine/*` imports inside `server/` — a pre-existing known follow-up (#13) that is NOT introduced by this plan. Ignore new `@engine/*` resolution errors only if they originate inside `server/`.
- Root lint: `npm run lint`.
- Server tests: `cd server && npm test`.
- Server typecheck: `cd server && npx tsc --noEmit` (must be clean).
- Server build + start: `cd server && npm run build && npm start` (only needed for manual E2E, not tests).

## Commit conventions

- Single-line subject, imperative, completing "This commit will…", ≤75 chars, no body, no `Co-Authored-By`, no Conventional-Commits prefix.
- Atomic commits. One logical change per commit.
- Example subjects: `Add requestRematch and rematchReady protocol messages`, `Create SeatViewModel and buildSeatViewModels helper`.

---

## Phase 0: Shared protocol types

### Task 0.1: Add rematch protocol messages on client and server

**Depends on:** nothing. Must complete before Phase 1.

**Files:**
- Modify: `src/lib/net/protocol.ts`
- Modify: `server/src/game/protocol.ts`

**Purpose:** Introduce the new message shapes so every downstream task can compile against them. No runtime behavior yet.

- [ ] **Step 1: Extend `ClientMessage` and `ServerMessage` in the client protocol module**

Edit `src/lib/net/protocol.ts`. Find the `ClientMessage` type and add a third variant; find the `ServerMessage` type and add a sixth variant. The new shapes:

```ts
export type ClientMessage =
  | { type: 'action'; action: GameAction }
  | { type: 'chat'; text: string }
  | { type: 'requestRematch' };

export type ServerMessage =
  | { type: 'hello';       stateVersion: number; view: GameView }
  | { type: 'state';       stateVersion: number; view: GameView }
  | { type: 'actionError'; reason: string; stateVersion: number }
  | { type: 'chat';        fromSlotIndex: number; fromName: string; text: string; sentAt: number }
  | { type: 'gameEnded';   stateVersion: number; view: GameView; reason: 'winner' | 'abandoned' }
  | { type: 'rematchReady'; newRoomId: string };
```

No other changes in this file.

- [ ] **Step 2: Extend the server `ClientMessageSchema` (Zod)**

Edit `server/src/game/protocol.ts`. Locate `ClientMessageSchema` (a `z.union` currently with `action` and `chat` branches). Add a third branch for `requestRematch`, and extend `ClientMessage` (`z.infer`) automatically picks it up. Then extend `ServerMessage` with the `rematchReady` variant.

Final shape:

```ts
export const ClientMessageSchema = z.union([
  z.object({ type: z.literal('action'), action: GameActionSchema }).strict(),
  z.object({ type: z.literal('chat'), text: z.string().min(1).max(MAX_CHAT_LEN) }).strict(),
  z.object({ type: z.literal('requestRematch') }).strict(),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type ServerMessage =
  | { type: 'hello';       stateVersion: number; view: GameView }
  | { type: 'state';       stateVersion: number; view: GameView }
  | { type: 'actionError'; reason: string; stateVersion: number }
  | { type: 'chat';        fromSlotIndex: number; fromName: string; text: string; sentAt: number }
  | { type: 'gameEnded';   stateVersion: number; view: GameView; reason: 'winner' | 'abandoned' }
  | { type: 'rematchReady'; newRoomId: string };
```

- [ ] **Step 3: Write a typecheck-only assertion test on the client side**

Create an assertion test to lock the protocol shape. Edit `src/lib/net/protocol.ts` only if you want a compile-time guard, but cleanest is a separate test file.

Create `src/lib/net/protocol.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ClientMessage, ServerMessage } from './protocol';

describe('protocol shapes', () => {
  it('includes requestRematch in ClientMessage', () => {
    const msg: ClientMessage = { type: 'requestRematch' };
    expect(msg.type).toBe('requestRematch');
  });

  it('includes rematchReady in ServerMessage', () => {
    const msg: ServerMessage = { type: 'rematchReady', newRoomId: 'abc' };
    expect(msg.type).toBe('rematchReady');
    expect(msg.newRoomId).toBe('abc');
  });
});
```

- [ ] **Step 4: Write a Zod parse test on the server side**

Create `server/tests/game/protocol.requestRematch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ClientMessageSchema } from '../../src/game/protocol';

describe('ClientMessageSchema requestRematch', () => {
  it('accepts { type: "requestRematch" }', () => {
    const parsed = ClientMessageSchema.safeParse({ type: 'requestRematch' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.type).toBe('requestRematch');
  });

  it('rejects requestRematch with extra fields (strict)', () => {
    const parsed = ClientMessageSchema.safeParse({ type: 'requestRematch', extra: 1 });
    expect(parsed.success).toBe(false);
  });
});
```

- [ ] **Step 5: Run the tests**

From repo root:

```
npm test -- src/lib/net/protocol.test.ts
```

Expected: 2 tests passing.

From `server/`:

```
cd server && npm test -- tests/game/protocol.requestRematch.test.ts
```

Expected: 2 tests passing.

- [ ] **Step 6: Run typechecks**

```
npx tsc --noEmit
cd server && npx tsc --noEmit
```

Root may still report `@engine/*` resolution errors inside `server/` (pre-existing). Server must be clean.

- [ ] **Step 7: Commit**

```
git add src/lib/net/protocol.ts src/lib/net/protocol.test.ts \
         server/src/game/protocol.ts server/tests/game/protocol.requestRematch.test.ts
git commit -m "Add requestRematch and rematchReady protocol messages"
```

---

## Phase 1: Independent foundation work (parallel)

### Task 1.1: SeatViewModel type and builder

**Depends on:** Task 0.1.

**Files:**
- Create: `src/lib/view/seat.ts`
- Create: `src/lib/view/seat.test.ts`

**Purpose:** Define the prop shape consumed by the new `Seat` render layer — a per-slot view model derived from the wire `PlayerView` + `GameViewSeat[]`. Include a pure builder that Board will call once per render.

- [ ] **Step 1: Write the failing test**

Create `src/lib/view/seat.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSeatViewModels, type SeatViewModel } from './seat';
import type { GameView, GameViewSeat, PlayerView } from '@/lib/net/protocol';
import type { Card } from '@/lib/game/types';

const TEAM_COLORS = ['#aa0000', '#00aa00'];

function makeCard(id: string, value: Card['value']): Card {
  return { id, value };
}

function baseView(): PlayerView {
  return {
    config: {
      ruleset: 'recommended',
      stockPileSize: 15,
      handSize: 5,
      bidirectionalBuild: true,
      maxPlayers: 8,
      partnership: null,
    },
    phase: 'playing',
    turnPhase: 'play',
    currentPlayerSlotIndex: 0,
    youSlotIndex: 0,
    winningTeamIndex: null,
    stateVersion: 1,
    buildPiles: [],
    drawPileCount: 100,
    you: {
      name: 'Alice',
      hand: [makeCard('h1', 3), makeCard('h2', 7)],
      stockPile: [makeCard('s1', 5), makeCard('s2', 2)],
      discardPiles: [[], [makeCard('d1', 4)], [], []],
    },
    opponents: [
      {
        slotIndex: 1,
        name: 'Bob',
        handCount: 4,
        stockCount: 15,
        stockTop: { id: 's-bob', value: 9 },
        discardPiles: [[], [], [{ id: 'd-bob', value: 1 }], []],
      },
    ],
  };
}

function baseSeats(): GameViewSeat[] {
  return [
    { slotIndex: 0, kind: 'human', name: 'Alice', connected: true, graceDeadline: null, botControlled: false, isHost: true },
    { slotIndex: 1, kind: 'human', name: 'Bob', connected: true, graceDeadline: null, botControlled: false, isHost: false },
  ];
}

function build(view: PlayerView = baseView(), seats: GameViewSeat[] = baseSeats()): SeatViewModel[] {
  return buildSeatViewModels({ view, seats, teamColors: TEAM_COLORS });
}

describe('buildSeatViewModels', () => {
  it('produces one view model per seat in slot order', () => {
    const models = build();
    expect(models).toHaveLength(2);
    expect(models.map((m) => m.slotIndex)).toEqual([0, 1]);
  });

  it('marks the viewer seat isYou=true and attaches real hand cards', () => {
    const models = build();
    expect(models[0]!.isYou).toBe(true);
    expect(models[0]!.handCards).toEqual([
      { id: 'h1', value: 3 },
      { id: 'h2', value: 7 },
    ]);
    expect(models[0]!.handCount).toBe(2);
  });

  it('marks opponents isYou=false with null handCards and count from wire', () => {
    const models = build();
    expect(models[1]!.isYou).toBe(false);
    expect(models[1]!.handCards).toBeNull();
    expect(models[1]!.handCount).toBe(4);
  });

  it('marks the current player isActive', () => {
    const models = build();
    expect(models[0]!.isActive).toBe(true);
    expect(models[1]!.isActive).toBe(false);
  });

  it('derives stockTop/stockCount and discard piles for viewer and opponent', () => {
    const models = build();
    expect(models[0]!.stockTop).toEqual({ id: 's2', value: 2 });
    expect(models[0]!.stockCount).toBe(2);
    expect(models[0]!.discardPiles).toEqual([[], [{ id: 'd1', value: 4 }], [], []]);
    expect(models[1]!.stockTop).toEqual({ id: 's-bob', value: 9 });
    expect(models[1]!.stockCount).toBe(15);
    expect(models[1]!.discardPiles).toEqual([[], [], [{ id: 'd-bob', value: 1 }], []]);
  });

  it('derives presence: online for connected humans', () => {
    const models = build();
    expect(models[0]!.presence).toBe('online');
    expect(models[1]!.presence).toBe('online');
  });

  it('derives presence: offline for disconnected humans with no grace and no bot', () => {
    const seats = baseSeats();
    seats[1] = { ...seats[1]!, connected: false };
    const models = build(baseView(), seats);
    expect(models[1]!.presence).toBe('offline');
  });

  it('derives presence: grace when graceDeadline is set', () => {
    const seats = baseSeats();
    seats[1] = { ...seats[1]!, connected: false, graceDeadline: Date.now() + 10_000 };
    const models = build(baseView(), seats);
    expect(models[1]!.presence).toBe('grace');
  });

  it('derives presence: bot when botControlled', () => {
    const seats = baseSeats();
    seats[1] = { ...seats[1]!, connected: false, botControlled: true };
    const models = build(baseView(), seats);
    expect(models[1]!.presence).toBe('bot');
  });

  it('derives presence: ai when seat.kind is ai', () => {
    const seats = baseSeats();
    seats[1] = { slotIndex: 1, kind: 'ai', name: 'bot-x', connected: true, graceDeadline: null, botControlled: false, isHost: false };
    const models = build(baseView(), seats);
    expect(models[1]!.presence).toBe('ai');
  });

  it('derives presence: empty for open or locked seats', () => {
    const seats: GameViewSeat[] = [
      { slotIndex: 0, kind: 'human', name: 'Alice', connected: true, graceDeadline: null, botControlled: false, isHost: true },
      { slotIndex: 1, kind: 'open', name: null, connected: false, graceDeadline: null, botControlled: false, isHost: false },
      { slotIndex: 2, kind: 'locked', name: null, connected: false, graceDeadline: null, botControlled: false, isHost: false },
    ];
    const view = baseView();
    view.opponents = [];
    const models = build(view, seats);
    expect(models[1]!.presence).toBe('empty');
    expect(models[2]!.presence).toBe('empty');
  });

  it('resolves team membership from view.config.partnership.teams by slot index', () => {
    const view = baseView();
    view.config = {
      ...view.config,
      partnership: {
        enabled: true,
        teams: [[0], [1]],
        allowPlayFromPartnerStock: true,
        allowPlayFromPartnerDiscard: true,
        allowDiscardToPartnerDiscard: true,
      },
    };
    const models = build(view);
    expect(models[0]!.team).toEqual({ index: 0, color: TEAM_COLORS[0] });
    expect(models[1]!.team).toEqual({ index: 1, color: TEAM_COLORS[1] });
  });

  it('omits team when partnership is null', () => {
    const models = build();
    expect(models[0]!.team).toBeNull();
    expect(models[1]!.team).toBeNull();
  });

  it('flags isHost from seat.isHost', () => {
    const models = build();
    expect(models[0]!.isHost).toBe(true);
    expect(models[1]!.isHost).toBe(false);
  });

  it('renders a sensible fallback name for seats without a name', () => {
    const seats = baseSeats();
    seats[1] = { ...seats[1]!, kind: 'open', name: null };
    const view = baseView();
    view.opponents = [];
    const models = build(view, seats);
    expect(models[1]!.name).toBe('Empty seat');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
npm test -- src/lib/view/seat.test.ts
```

Expected: cannot resolve module `./seat`, all tests fail to load.

- [ ] **Step 3: Implement the type and builder**

Create `src/lib/view/seat.ts`:

```ts
import type { Card, CardValue } from '@/lib/game/types';
import type { GameViewSeat, OpponentView, PlayerView } from '@/lib/net/protocol';

export interface CardLite {
  id: string;
  value: CardValue;
}

export type SeatPresence =
  | 'online'
  | 'offline'
  | 'grace'
  | 'bot'
  | 'ai'
  | 'empty';

export interface SeatViewModel {
  slotIndex: number;
  name: string;
  handCards: Card[] | null;
  handCount: number;
  stockTop: CardLite | null;
  stockCount: number;
  discardPiles: CardLite[][];
  team: { index: number; color: string } | null;
  isActive: boolean;
  isYou: boolean;
  isHost: boolean;
  presence: SeatPresence;
}

export interface BuildSeatViewModelsArgs {
  view: PlayerView;
  seats: GameViewSeat[];
  teamColors: readonly string[];
}

export function buildSeatViewModels(args: BuildSeatViewModelsArgs): SeatViewModel[] {
  const { view, seats, teamColors } = args;
  const opponents = new Map<number, OpponentView>();
  for (const op of view.opponents) opponents.set(op.slotIndex, op);

  return seats.map((seat) => {
    const isYou = seat.slotIndex === view.youSlotIndex;
    const isActive = seat.slotIndex === view.currentPlayerSlotIndex;
    const team = teamFor(view, seat.slotIndex, teamColors);
    const presence = presenceOf(seat);

    if (isYou) {
      const stock = view.you.stockPile;
      return {
        slotIndex: seat.slotIndex,
        name: seat.name ?? view.you.name ?? 'You',
        handCards: view.you.hand,
        handCount: view.you.hand.length,
        stockTop: stock.length > 0 ? { id: stock[stock.length - 1]!.id, value: stock[stock.length - 1]!.value } : null,
        stockCount: stock.length,
        discardPiles: view.you.discardPiles.map((pile) => pile.map((c) => ({ id: c.id, value: c.value }))),
        team,
        isActive,
        isYou: true,
        isHost: seat.isHost,
        presence,
      };
    }

    const opponent = opponents.get(seat.slotIndex);
    if (opponent) {
      return {
        slotIndex: seat.slotIndex,
        name: seat.name ?? opponent.name ?? fallbackName(seat),
        handCards: null,
        handCount: opponent.handCount,
        stockTop: opponent.stockTop,
        stockCount: opponent.stockCount,
        discardPiles: opponent.discardPiles,
        team,
        isActive,
        isYou: false,
        isHost: seat.isHost,
        presence,
      };
    }

    // Empty / locked / ai with no corresponding OpponentView entry.
    return {
      slotIndex: seat.slotIndex,
      name: seat.name ?? fallbackName(seat),
      handCards: null,
      handCount: 0,
      stockTop: null,
      stockCount: 0,
      discardPiles: [[], [], [], []],
      team,
      isActive,
      isYou: false,
      isHost: seat.isHost,
      presence,
    };
  });
}

function teamFor(view: PlayerView, slotIndex: number, colors: readonly string[]): SeatViewModel['team'] {
  const partnership = view.config.partnership;
  if (!partnership) return null;
  for (let i = 0; i < partnership.teams.length; i++) {
    if (partnership.teams[i]!.includes(slotIndex)) {
      return { index: i, color: colors[i % colors.length]! };
    }
  }
  return null;
}

function presenceOf(seat: GameViewSeat): SeatPresence {
  if (seat.kind === 'ai') return 'ai';
  if (seat.kind === 'open' || seat.kind === 'locked') return 'empty';
  if (seat.botControlled) return 'bot';
  if (seat.graceDeadline !== null) return 'grace';
  if (seat.connected) return 'online';
  return 'offline';
}

function fallbackName(seat: GameViewSeat): string {
  if (seat.kind === 'open' || seat.kind === 'locked') return 'Empty seat';
  return 'Player';
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

```
npm test -- src/lib/view/seat.test.ts
```

Expected: 14 tests passing.

- [ ] **Step 5: Run full main-app tests + typecheck**

```
npm test
npx tsc --noEmit
```

Expected: no new failures outside the existing `@engine/*`-inside-`server/` errors.

- [ ] **Step 6: Commit**

```
git add src/lib/view/seat.ts src/lib/view/seat.test.ts
git commit -m "Create SeatViewModel type and buildSeatViewModels helper"
```

---

### Task 1.2: engineStateToView adapter

**Depends on:** Task 0.1.

**Files:**
- Create: `src/lib/view/fromEngine.ts`
- Create: `src/lib/view/fromEngine.test.ts`

**Purpose:** Pure function converting the hot-seat engine state into the networked wire shape so `/local` can feed `Board` through the same prop contract as `/rooms/[roomId]`. This is the audit ratchet: strips `seed`, rewrites partnership team arrays from engine ids to slot indices, populates synthetic `GameViewSeat[]` entries that never carry a sessionId.

- [ ] **Step 1: Write the failing test**

Create `src/lib/view/fromEngine.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createGame } from '@/lib/game/engine';
import { engineStateToView } from './fromEngine';

function makePlayers(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));
}

describe('engineStateToView', () => {
  it('strips seed from the view config', () => {
    const state = createGame({ players: makePlayers(2), ruleset: 'recommended', seed: 12345 });
    const { view } = engineStateToView(state, 0);
    expect(view.config).not.toHaveProperty('seed');
  });

  it('honors youPlayerIndex for view.youSlotIndex', () => {
    const state = createGame({ players: makePlayers(3), ruleset: 'recommended' });
    const { view } = engineStateToView(state, 1);
    expect(view.youSlotIndex).toBe(1);
    expect(view.you.hand).toEqual(state.players[1]!.hand);
    expect(view.you.stockPile).toEqual(state.players[1]!.stockPile);
  });

  it('exposes opponents for every other engine player', () => {
    const state = createGame({ players: makePlayers(3), ruleset: 'recommended' });
    const { view } = engineStateToView(state, 0);
    expect(view.opponents).toHaveLength(2);
    expect(view.opponents.map((o) => o.slotIndex).sort()).toEqual([1, 2]);
    for (const op of view.opponents) {
      const source = state.players[op.slotIndex]!;
      expect(op.handCount).toBe(source.hand.length);
      expect(op.stockCount).toBe(source.stockPile.length);
      if (source.stockPile.length > 0) {
        const top = source.stockPile[source.stockPile.length - 1]!;
        expect(op.stockTop).toEqual({ id: top.id, value: top.value });
      } else {
        expect(op.stockTop).toBeNull();
      }
    }
  });

  it('rewrites partnership team ids to slot indices', () => {
    const state = createGame({
      players: makePlayers(4),
      ruleset: 'recommended',
      partnership: {
        enabled: true,
        teams: [['p1', 'p3'], ['p2', 'p4']],
        allowPlayFromPartnerStock: true,
        allowPlayFromPartnerDiscard: true,
        allowDiscardToPartnerDiscard: true,
      },
    });
    const { view } = engineStateToView(state, 0);
    expect(view.config.partnership).not.toBeNull();
    expect(view.config.partnership!.teams).toEqual([[0, 2], [1, 3]]);
    expect(view.config.partnership!.enabled).toBe(true);
  });

  it('produces synthetic seats: host=youSlot, all human, connected, no grace, no bot', () => {
    const state = createGame({ players: makePlayers(3), ruleset: 'recommended' });
    const { seats } = engineStateToView(state, 2);
    expect(seats).toHaveLength(3);
    for (const s of seats) {
      expect(s.kind).toBe('human');
      expect(s.connected).toBe(true);
      expect(s.graceDeadline).toBeNull();
      expect(s.botControlled).toBe(false);
    }
    expect(seats[0]!.isHost).toBe(false);
    expect(seats[1]!.isHost).toBe(false);
    expect(seats[2]!.isHost).toBe(true);
  });

  it('carries through phase, currentPlayerSlotIndex, stateVersion', () => {
    const state = createGame({ players: makePlayers(2), ruleset: 'recommended' });
    const { view } = engineStateToView(state, 0);
    expect(view.phase).toBe(state.phase);
    expect(view.currentPlayerSlotIndex).toBe(state.currentPlayerIndex);
    expect(view.stateVersion).toBe(state.stateVersion);
  });

  it('carries winningTeamIndex through a finished game', () => {
    const state = createGame({ players: makePlayers(2), ruleset: 'recommended' });
    const finished = { ...state, phase: 'finished' as const, winningTeamIndex: 0 };
    const { view } = engineStateToView(finished, 0);
    expect(view.phase).toBe('finished');
    expect(view.winningTeamIndex).toBe(0);
  });

  it('uses engine player names, not ids, in seat.name', () => {
    const state = createGame({
      players: [
        { id: 'session-abc', name: 'Alice' },
        { id: 'session-xyz', name: 'Bob' },
      ],
      ruleset: 'recommended',
    });
    const { seats } = engineStateToView(state, 0);
    expect(seats[0]!.name).toBe('Alice');
    expect(seats[1]!.name).toBe('Bob');
    // Defensive: assert no sessionId accidentally leaks into any seat field.
    for (const seat of seats) {
      expect(JSON.stringify(seat)).not.toContain('session-abc');
      expect(JSON.stringify(seat)).not.toContain('session-xyz');
    }
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```
npm test -- src/lib/view/fromEngine.test.ts
```

Expected: cannot resolve `./fromEngine`.

- [ ] **Step 3: Implement the adapter**

Create `src/lib/view/fromEngine.ts`:

```ts
import type { GameConfig, GameState, PartnershipRules } from '@/lib/game/types';
import type {
  GameView,
  GameViewSeat,
  OpponentView,
  PlayerView,
  PublicGameConfig,
  PublicPartnershipRules,
} from '@/lib/net/protocol';

export function engineStateToView(state: GameState, youPlayerIndex: number): GameView {
  const players = state.players;
  const you = players[youPlayerIndex];
  if (!you) {
    throw new Error(`engineStateToView: youPlayerIndex ${youPlayerIndex} out of range`);
  }

  const opponents: OpponentView[] = players
    .map((p, i) => ({ p, i }))
    .filter(({ i }) => i !== youPlayerIndex)
    .map(({ p, i }) => {
      const top = p.stockPile[p.stockPile.length - 1] ?? null;
      return {
        slotIndex: i,
        name: p.name,
        handCount: p.hand.length,
        stockCount: p.stockPile.length,
        stockTop: top ? { id: top.id, value: top.value } : null,
        discardPiles: p.discardPiles.map((pile) => pile.map((c) => ({ id: c.id, value: c.value }))),
      };
    });

  const view: PlayerView = {
    config: publicizeConfig(state.config, players),
    phase: state.phase,
    turnPhase: state.turnPhase,
    currentPlayerSlotIndex: state.currentPlayerIndex,
    youSlotIndex: youPlayerIndex,
    winningTeamIndex: state.winningTeamIndex,
    stateVersion: state.stateVersion,
    buildPiles: state.buildPiles,
    drawPileCount: state.drawPile.length,
    you: {
      name: you.name,
      hand: you.hand,
      stockPile: you.stockPile,
      discardPiles: you.discardPiles,
    },
    opponents,
  };

  const seats: GameViewSeat[] = players.map((p, i) => ({
    slotIndex: i,
    kind: 'human',
    name: p.name,
    connected: true,
    graceDeadline: null,
    botControlled: false,
    isHost: i === youPlayerIndex,
  }));

  return { view, seats };
}

function publicizeConfig(config: GameConfig, players: GameState['players']): PublicGameConfig {
  // Deliberately omit `seed` — the wire shape must never expose it because it
  // would let any client re-roll the RNG and reconstruct every opponent's
  // hidden state. Drop via destructuring so an accidental addition surfaces
  // as a typecheck error in the future.
  const { seed: _seed, partnership, ...rest } = config;
  return {
    ...rest,
    partnership: partnership ? publicizePartnership(partnership, players) : null,
  };
}

function publicizePartnership(
  partnership: PartnershipRules,
  players: GameState['players'],
): PublicPartnershipRules {
  const idToSlot = new Map<string, number>();
  players.forEach((p, i) => idToSlot.set(p.id, i));
  return {
    ...partnership,
    teams: partnership.teams.map((team) => team.map((id) => idToSlot.get(id) ?? -1)),
  };
}
```

- [ ] **Step 4: Run the test to confirm all pass**

```
npm test -- src/lib/view/fromEngine.test.ts
```

Expected: 8 tests passing.

- [ ] **Step 5: Run full tests + typecheck**

```
npm test
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```
git add src/lib/view/fromEngine.ts src/lib/view/fromEngine.test.ts
git commit -m "Add engineStateToView adapter for hot-seat to wire shape"
```

---

### Task 1.3: Registry rematch map

**Depends on:** Task 0.1.

**Files:**
- Modify: `server/src/game/registry.ts`
- Modify: `server/tests/game/registry.test.ts`

**Purpose:** Let the registry remember which rematch room was spawned from each finished source room, so the connection handler (Task 2.1) can be idempotent and the handshake can re-emit `rematchReady` on reconnect.

- [ ] **Step 1: Read the existing registry tests to understand the patterns used**

Open `server/tests/game/registry.test.ts` and observe its structure — it tests the `GameRegistry` class directly with fake `RegisteredConnection` objects.

- [ ] **Step 2: Write the failing tests**

Append the following describe block to `server/tests/game/registry.test.ts`:

```ts
describe('GameRegistry rematch map', () => {
  it('starts with no rematch mapping for any room', () => {
    const reg = new GameRegistry();
    expect(reg.getRematchRoomId('src-1')).toBeNull();
  });

  it('persists a set rematch id and returns it on getRematchRoomId', () => {
    const reg = new GameRegistry();
    reg.setRematchRoomId('src-1', 'new-1');
    expect(reg.getRematchRoomId('src-1')).toBe('new-1');
  });

  it('tracks multiple sources independently', () => {
    const reg = new GameRegistry();
    reg.setRematchRoomId('src-1', 'new-1');
    reg.setRematchRoomId('src-2', 'new-2');
    expect(reg.getRematchRoomId('src-1')).toBe('new-1');
    expect(reg.getRematchRoomId('src-2')).toBe('new-2');
  });

  it('overwrites on re-set (last write wins, though callers should not normally do this)', () => {
    const reg = new GameRegistry();
    reg.setRematchRoomId('src-1', 'new-1');
    reg.setRematchRoomId('src-1', 'new-2');
    expect(reg.getRematchRoomId('src-1')).toBe('new-2');
  });

  it('survives removing all connections in the source room', () => {
    const reg = new GameRegistry();
    const conn = { sessionId: 's1', send: () => {}, close: () => {} };
    reg.add('src-1', conn);
    reg.setRematchRoomId('src-1', 'new-1');
    reg.remove('src-1', conn);
    expect(reg.size('src-1')).toBe(0);
    expect(reg.getRematchRoomId('src-1')).toBe('new-1');
  });
});
```

Make sure `GameRegistry` is already imported at the top of the file.

- [ ] **Step 3: Run the tests to confirm they fail**

```
cd server && npm test -- tests/game/registry.test.ts
```

Expected: 5 new tests fail with `getRematchRoomId is not a function` / `setRematchRoomId is not a function`.

- [ ] **Step 4: Implement the feature**

Edit `server/src/game/registry.ts`. Add a new private `Map<string, string>` field beside the existing `rooms` field, and two new methods at the end of the class body. Do not remove or rename any existing field, method, or export.

Add near the top of the class body (right after `private readonly rooms = new Map<string, Set<RegisteredConnection>>();`):

```ts
private readonly rematchBySourceRoom = new Map<string, string>();
```

Add these two methods at the end of the class body (just before the closing `}`):

```ts
getRematchRoomId(sourceRoomId: string): string | null {
  return this.rematchBySourceRoom.get(sourceRoomId) ?? null;
}

setRematchRoomId(sourceRoomId: string, newRoomId: string): void {
  this.rematchBySourceRoom.set(sourceRoomId, newRoomId);
}
```

Do not modify `add`, `remove`, `size`, `findBySession`, `forEachInRoom`, `broadcast`, `broadcastCloseAll`, or `allConnections`. The rematch map is intentionally independent of the connections map because it must survive past the last connection leaving a finished room.

- [ ] **Step 5: Run the tests to confirm they pass**

```
cd server && npm test -- tests/game/registry.test.ts
```

Expected: all registry tests pass (original + 5 new).

- [ ] **Step 6: Run full server tests + typecheck**

```
cd server && npm test
cd server && npx tsc --noEmit
```

Expected: full suite green, typecheck clean.

- [ ] **Step 7: Commit**

```
git add server/src/game/registry.ts server/tests/game/registry.test.ts
git commit -m "Store rematch room mapping on GameRegistry"
```

---

### Task 1.4: RoomManager.createRematchRoom + sessionIndex migration

**Depends on:** Task 0.1.

**Files:**
- Modify: `server/src/room/manager.ts`
- Modify: `server/tests/room/manager.test.ts`

**Purpose:** Add the core server-side primitive the rematch flow calls. Creates a new `Room` cloned from the finished source, pre-seats the same humans with `botControlled: true`, migrates each `sessionIndex` entry atomically, and starts the game immediately (phase = `playing`). Also adjusts the post-finish cleanup path so it does not yank sessionIndex entries that have been reassigned.

- [ ] **Step 1: Read existing tests and the manager structure**

Open `server/tests/room/manager.test.ts` to see the fixture patterns. Open `server/src/room/manager.ts` to understand `create`, `buildInitialSlots`, `deleteRoom`, and `initializeGameState`.

Key pre-existing fact: `deleteRoom` at `server/src/room/manager.ts:346` deletes `sessionIndex` entries for every human slot. That must be made conditional.

- [ ] **Step 2: Write the failing tests**

Append the following describe block near the bottom of `server/tests/room/manager.test.ts`:

```ts
describe('RoomManager.createRematchRoom', () => {
  function makePlayingRoom() {
    const mgr = new RoomManager();
    const { room } = mgr.create({
      sessionId: 'sess-alice',
      playerName: 'Alice',
      // Explicit maxPlayers: 2 so there are no open seats to trip startGame.
      config: { ruleset: 'recommended', stockPileSize: 5, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null },
      allowAiFill: false,
      visibility: 'public',
    });
    mgr.addMember(room.id, { sessionId: 'sess-bob', playerName: 'Bob' });
    mgr.startGame(room.id, { actorSessionId: 'sess-alice' });
    return { mgr, room };
  }

  it('creates a new room in playing phase with a game state already initialized', () => {
    const { mgr, room } = makePlayingRoom();
    // Mark source as finished so createRematchRoom is legal to call.
    mgr.finishGame(room.id, 'winner');
    const seatedHumans = room.slots
      .filter((s) => s.kind === 'human')
      .map((s) => ({
        sessionId: (s as Extract<typeof s, { kind: 'human' }>).sessionId,
        name: (s as Extract<typeof s, { kind: 'human' }>).name,
        slotIndex: room.slots.indexOf(s),
      }));

    const { room: next } = mgr.createRematchRoom({ sourceRoom: room, seatedHumans });
    expect(next.phase).toBe('playing');
    expect(next.game).not.toBeNull();
    expect(next.config.ruleset).toBe(room.config.ruleset);
    expect(next.config.maxPlayers).toBe(room.config.maxPlayers);
  });

  it('pre-seats each human at their original slot index with botControlled=true', () => {
    const { mgr, room } = makePlayingRoom();
    mgr.finishGame(room.id, 'winner');
    const originals = room.slots.map((s, i) => ({ slot: s, i }));
    const seatedHumans = originals
      .filter((x) => x.slot.kind === 'human')
      .map((x) => ({
        sessionId: (x.slot as Extract<typeof x.slot, { kind: 'human' }>).sessionId,
        name: (x.slot as Extract<typeof x.slot, { kind: 'human' }>).name,
        slotIndex: x.i,
      }));

    const { room: next } = mgr.createRematchRoom({ sourceRoom: room, seatedHumans });
    for (const entry of seatedHumans) {
      const slot = next.slots[entry.slotIndex];
      expect(slot).toBeDefined();
      expect(slot!.kind).toBe('human');
      if (slot!.kind === 'human') {
        expect(slot.sessionId).toBe(entry.sessionId);
        expect(slot.name).toBe(entry.name);
        expect(slot.connected).toBe(false);
        expect(slot.botControlled).toBe(true);
        expect(slot.graceDeadline).toBeNull();
      }
    }
  });

  it('migrates each seated sessionIndex from source to new room atomically', () => {
    const { mgr, room } = makePlayingRoom();
    mgr.finishGame(room.id, 'winner');
    const seatedHumans = room.slots
      .map((slot, i) => ({ slot, i }))
      .filter((x) => x.slot.kind === 'human')
      .map((x) => ({
        sessionId: (x.slot as Extract<typeof x.slot, { kind: 'human' }>).sessionId,
        name: (x.slot as Extract<typeof x.slot, { kind: 'human' }>).name,
        slotIndex: x.i,
      }));
    const { room: next } = mgr.createRematchRoom({ sourceRoom: room, seatedHumans });
    for (const s of seatedHumans) {
      expect(mgr.sessionRoomId(s.sessionId)).toBe(next.id);
    }
  });

  it('sets hostSessionId to the first seated human (slot 0)', () => {
    const { mgr, room } = makePlayingRoom();
    mgr.finishGame(room.id, 'winner');
    const seatedHumans = room.slots
      .map((slot, i) => ({ slot, i }))
      .filter((x) => x.slot.kind === 'human')
      .map((x) => ({
        sessionId: (x.slot as Extract<typeof x.slot, { kind: 'human' }>).sessionId,
        name: (x.slot as Extract<typeof x.slot, { kind: 'human' }>).name,
        slotIndex: x.i,
      }));
    const { room: next } = mgr.createRematchRoom({ sourceRoom: room, seatedHumans });
    expect(next.hostSessionId).toBe(seatedHumans[0]!.sessionId);
  });

  it('generates a fresh seed so the cloned config does not replay the original shuffle', () => {
    const { mgr, room } = makePlayingRoom();
    mgr.finishGame(room.id, 'winner');
    const seatedHumans = room.slots
      .map((slot, i) => ({ slot, i }))
      .filter((x) => x.slot.kind === 'human')
      .map((x) => ({
        sessionId: (x.slot as Extract<typeof x.slot, { kind: 'human' }>).sessionId,
        name: (x.slot as Extract<typeof x.slot, { kind: 'human' }>).name,
        slotIndex: x.i,
      }));
    const { room: next } = mgr.createRematchRoom({ sourceRoom: room, seatedHumans });
    if (room.config.seed !== undefined && next.config.seed !== undefined) {
      expect(next.config.seed).not.toBe(room.config.seed);
    }
  });

  it('does not delete reassigned sessionIndex entries when source room cleanup fires', () => {
    const { mgr, room } = makePlayingRoom();
    mgr.finishGame(room.id, 'winner');
    const seatedHumans = room.slots
      .map((slot, i) => ({ slot, i }))
      .filter((x) => x.slot.kind === 'human')
      .map((x) => ({
        sessionId: (x.slot as Extract<typeof x.slot, { kind: 'human' }>).sessionId,
        name: (x.slot as Extract<typeof x.slot, { kind: 'human' }>).name,
        slotIndex: x.i,
      }));
    const { room: next } = mgr.createRematchRoom({ sourceRoom: room, seatedHumans });
    // Force-trigger the source room's deletion (post-game cleanup path).
    (mgr as any).deleteRoom(room, { reason: 'postGame' });
    for (const s of seatedHumans) {
      expect(mgr.sessionRoomId(s.sessionId)).toBe(next.id);
    }
  });

  it('clones AI slots and leaves open/locked slots as-is', () => {
    const mgr = new RoomManager();
    const { room } = mgr.create({
      sessionId: 'sess-alice',
      playerName: 'Alice',
      config: { ruleset: 'recommended', stockPileSize: 5, handSize: 5, bidirectionalBuild: true, maxPlayers: 4, partnership: null },
      allowAiFill: false,
      visibility: 'public',
    });
    room.slots[1] = { kind: 'ai', botId: 'bot-123', difficulty: 'easy' };
    room.slots[2] = { kind: 'locked' };
    // slot 3 remains 'open' — we flip phase manually below to bypass startGame's
    // open-slots guard rather than toggling allowAiFill (would convert the open
    // slot into AI and mask the "open stays open" assertion).
    room.phase = 'finished';
    room.finishedAt = Date.now();
    const seatedHumans = [
      { sessionId: 'sess-alice', name: 'Alice', slotIndex: 0 },
    ];
    const { room: next } = mgr.createRematchRoom({ sourceRoom: room, seatedHumans });
    expect(next.slots[1]!.kind).toBe('ai');
    expect(next.slots[2]!.kind).toBe('locked');
    expect(next.slots[3]!.kind).toBe('open');
  });
});
```

The existing test file may already import `RoomManager` and `defaultConfigForRuleset`. Add imports as needed. If `mgr.joinByCode` or `mgr.startGame` have different names in the actual implementation, adjust to match. Open `server/src/room/manager.ts` to verify.

- [ ] **Step 3: Run the tests to confirm they fail**

```
cd server && npm test -- tests/room/manager.test.ts
```

Expected: 7 new tests fail with `createRematchRoom is not a function`.

- [ ] **Step 4: Implement `createRematchRoom`**

Edit `server/src/room/manager.ts`. Add the method to the `RoomManager` class:

```ts
export interface CreateRematchRoomInput {
  sourceRoom: Room;
  seatedHumans: Array<{
    sessionId: string;
    name: string;
    slotIndex: number;
  }>;
}

// Then inside the RoomManager class body, add:

createRematchRoom(input: CreateRematchRoomInput): { room: Room } {
  const { sourceRoom, seatedHumans } = input;
  const id = randomUUID();
  const code = this.allocateCode();
  const now = Date.now();

  // Build slots: clone source structure, replace each seated slot with the
  // bot-controlled human entry. Slots not named in seatedHumans keep their
  // source shape (ai / open / locked).
  const slots: Room['slots'] = sourceRoom.slots.map((slot) => {
    if (slot.kind === 'ai') return { ...slot };
    if (slot.kind === 'locked') return { kind: 'locked' as const };
    return { kind: 'open' as const };
  });
  for (const entry of seatedHumans) {
    slots[entry.slotIndex] = {
      kind: 'human',
      sessionId: entry.sessionId,
      name: entry.name,
      connected: false,
      joinedAt: now,
      graceDeadline: null,
      graceTimer: null,
      botControlled: true,
    };
  }

  const firstSeated = seatedHumans[0];
  const hostSessionId = firstSeated ? firstSeated.sessionId : '';

  // Fresh seed so the new shuffle differs from the source game. Keeps all
  // other config fields (ruleset, sizes, partnership flags) intact.
  const config: GameConfig = {
    ...sourceRoom.config,
    seed: Math.floor(Math.random() * 0xffffffff),
  };

  const room: Room = {
    id,
    code,
    displayName: `${sourceRoom.displayName} (rematch)`,
    visibility: sourceRoom.visibility,
    phase: 'waiting',
    hostSessionId,
    config,
    allowAiFill: sourceRoom.allowAiFill,
    slots,
    game: null,
    createdAt: now,
    lastActivityAt: now,
    finishedAt: null,
    kickedSessionIds: new Set(),
    idleTimer: null,
    cleanupTimer: null,
    botPending: new Set<number>(),
  };

  this.rooms.set(id, room);
  this.codeIndex.set(code, id);
  // Atomic sessionIndex migration: for each seated human, retarget their
  // mapping to point at the new room. The old room's slot entries remain
  // (the finished board UI still needs the name / host data until cleanup)
  // but the authoritative "which room does this session belong to" lookup
  // now resolves to the rematch.
  for (const entry of seatedHumans) {
    this.sessionIndex.set(entry.sessionId, id);
  }

  // Start the game immediately so the handshake's `phase === 'playing'`
  // gate passes by the time any client reconnects.
  room.game = initializeGameState(room);
  room.phase = 'playing';

  if (room.visibility === 'public') {
    this.events.emit('roomAdded', {
      type: 'roomAdded',
      room: projectRoomInfo(room, { context: 'list' }),
    });
  }
  this.scheduleIdle(room);
  return { room };
}
```

Add the import for `GameConfig` at the top of the file if not already present:

```ts
import type { GameConfig } from '@engine/types';
```

`initializeGameState` and `randomUUID` are already imported (used elsewhere in the file). Verify and add if missing.

- [ ] **Step 5: Adjust `deleteRoom` to skip reassigned sessionIndex entries**

In the same file, find `deleteRoom` (around line 342). Change the sessionIndex-removal loop (currently line 346) from:

```ts
for (const slot of room.slots) {
  if (slot.kind === 'human') this.sessionIndex.delete(slot.sessionId);
}
```

to:

```ts
for (const slot of room.slots) {
  if (slot.kind !== 'human') continue;
  // If the sessionIndex has already been retargeted (createRematchRoom
  // moves entries atomically when spawning a rematch), leave it alone.
  if (this.sessionIndex.get(slot.sessionId) === room.id) {
    this.sessionIndex.delete(slot.sessionId);
  }
}
```

- [ ] **Step 6: Run the tests to confirm they pass**

```
cd server && npm test -- tests/room/manager.test.ts
```

Expected: full manager.test.ts suite green, including the 7 new cases.

- [ ] **Step 7: Run full server tests + typecheck**

```
cd server && npm test
cd server && npx tsc --noEmit
```

Expected: suite green, typecheck clean.

- [ ] **Step 8: Commit**

```
git add server/src/room/manager.ts server/tests/room/manager.test.ts
git commit -m "Add createRematchRoom with session index migration"
```

---

### Task 1.5: useGameSocket rematch state and send method

**Depends on:** Task 0.1.

**Files:**
- Modify: `src/lib/net/useGameSocket.ts`
- Modify: `src/lib/net/useGameSocket.test.ts`

**Purpose:** Extend the client hook with `rematchRoomId: string | null` and `requestRematch: () => void`. State is sticky across plain reconnects (a brief drop during "Creating rematch…" must not lose the id) but clears on `roomId`/`sessionId` change. The returned hook shape is additive to the existing GameSocket interface.

- [ ] **Step 1: Read the existing useGameSocket tests**

Open `src/lib/net/useGameSocket.test.ts` to understand the existing unit tests (they cover helper functions, not the hook itself). The hook logic has never been React-rendered in tests.

- [ ] **Step 2: Write the failing test for hook state plumbing**

Append a describe block to `src/lib/net/useGameSocket.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ServerMessage } from './protocol';

// Pure helpers: reducer-like functions we extract so we can test the
// state transitions without React or a live socket.
import {
  applyServerMessageToRematch,
  clearRematchOnIdentityChange,
} from './useGameSocket';

describe('applyServerMessageToRematch', () => {
  it('sets rematchRoomId on rematchReady', () => {
    const msg: ServerMessage = { type: 'rematchReady', newRoomId: 'room-42' };
    expect(applyServerMessageToRematch(null, msg)).toBe('room-42');
  });

  it('is idempotent when applied twice with the same id', () => {
    const msg: ServerMessage = { type: 'rematchReady', newRoomId: 'room-42' };
    const first = applyServerMessageToRematch(null, msg);
    const second = applyServerMessageToRematch(first, msg);
    expect(second).toBe('room-42');
  });

  it('last-write-wins if a different id arrives (shouldn\'t happen, but defensive)', () => {
    const first = applyServerMessageToRematch(null, { type: 'rematchReady', newRoomId: 'a' });
    const second = applyServerMessageToRematch(first, { type: 'rematchReady', newRoomId: 'b' });
    expect(second).toBe('b');
  });

  it('leaves existing rematchRoomId untouched on other message types', () => {
    const msg: ServerMessage = { type: 'chat', fromSlotIndex: 0, fromName: 'x', text: 'y', sentAt: 0 };
    expect(applyServerMessageToRematch('room-42', msg)).toBe('room-42');
  });
});

describe('clearRematchOnIdentityChange', () => {
  it('clears rematchRoomId when roomId changes', () => {
    expect(
      clearRematchOnIdentityChange({ prevRoomId: 'a', prevSessionId: 's', nextRoomId: 'b', nextSessionId: 's', rematch: 'r' }),
    ).toBeNull();
  });

  it('clears rematchRoomId when sessionId changes', () => {
    expect(
      clearRematchOnIdentityChange({ prevRoomId: 'a', prevSessionId: 's1', nextRoomId: 'a', nextSessionId: 's2', rematch: 'r' }),
    ).toBeNull();
  });

  it('keeps rematchRoomId when neither roomId nor sessionId changed', () => {
    expect(
      clearRematchOnIdentityChange({ prevRoomId: 'a', prevSessionId: 's', nextRoomId: 'a', nextSessionId: 's', rematch: 'r' }),
    ).toBe('r');
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail**

```
npm test -- src/lib/net/useGameSocket.test.ts
```

Expected: import errors for `applyServerMessageToRematch` and `clearRematchOnIdentityChange`.

- [ ] **Step 4: Extract the two pure helpers and extend the hook shape**

Edit `src/lib/net/useGameSocket.ts`. Add the helpers as named exports near the top (next to `computeReconnectDelay` / `shouldReconnect`), then extend the `GameSocket` interface and wire the state into the main hook.

Add the helpers:

```ts
export function applyServerMessageToRematch(
  prev: string | null,
  msg: ServerMessage,
): string | null {
  if (msg.type === 'rematchReady') return msg.newRoomId;
  return prev;
}

export function clearRematchOnIdentityChange(args: {
  prevRoomId: string;
  prevSessionId: string;
  nextRoomId: string;
  nextSessionId: string;
  rematch: string | null;
}): string | null {
  if (args.prevRoomId !== args.nextRoomId) return null;
  if (args.prevSessionId !== args.nextSessionId) return null;
  return args.rematch;
}
```

Extend the `GameSocket` interface:

```ts
export interface GameSocket {
  view: GameView | null;
  stateVersion: number;
  status: GameSocketStatus;
  lastError: { code: number; reason: string } | null;
  lastActionError: { reason: string } | null;
  sendAction: (action: GameAction) => void;
  sendChat: (text: string) => void;
  requestRematch: () => void;
  rematchRoomId: string | null;
  chat: ChatEntry[];
}
```

Inside the `useGameSocket` hook body:

1. Add state: `const [rematchRoomId, setRematchRoomId] = useState<string | null>(null);`
2. In the `ws.onmessage` handler, add a case for `rematchReady`:

   ```ts
   case 'rematchReady':
     setRematchRoomId((prev) => applyServerMessageToRematch(prev, msg));
     break;
   ```
3. Add a `requestRematch` callback before the return:

   ```ts
   const requestRematch = useCallback(() => {
     enqueue({ type: 'requestRematch' });
   }, [enqueue]);
   ```
4. Clear `rematchRoomId` across identity changes. Add a `useEffect` keyed on `[roomId, sessionId]`:

   ```ts
   const prevIdentityRef = useRef<{ roomId: string; sessionId: string }>({ roomId, sessionId });
   useEffect(() => {
     const prev = prevIdentityRef.current;
     setRematchRoomId((r) =>
       clearRematchOnIdentityChange({
         prevRoomId: prev.roomId,
         prevSessionId: prev.sessionId,
         nextRoomId: roomId,
         nextSessionId: sessionId,
         rematch: r,
       }),
     );
     prevIdentityRef.current = { roomId, sessionId };
   }, [roomId, sessionId]);
   ```
5. Return the new fields:

   ```ts
   return { view, stateVersion, status, lastError, lastActionError, sendAction, sendChat, requestRematch, rematchRoomId, chat };
   ```

- [ ] **Step 5: Run tests to confirm they pass**

```
npm test -- src/lib/net/useGameSocket.test.ts
```

Expected: all tests passing (including the 7 new ones).

- [ ] **Step 6: Run full tests + typecheck**

```
npm test
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```
git add src/lib/net/useGameSocket.ts src/lib/net/useGameSocket.test.ts
git commit -m "Add rematch state and requestRematch to useGameSocket"
```

---

## Phase 2: Wire rematch on the server

### Task 2.1: dispatch requestRematch + connection handler + attach-time host migration

**Depends on:** Task 0.1, Task 1.3, Task 1.4.

**Files:**
- Modify: `server/src/game/dispatch.ts`
- Modify: `server/src/game/connection.ts`
- Modify: `server/tests/game/dispatch.test.ts`
- Create: `server/tests/game/rematch.test.ts`

**Purpose:** Dispatch the new `requestRematch` client message as a `createRematch` effect; have the connection handler translate that effect into `RoomManager.createRematchRoom` + `registry.setRematchRoomId` + broadcast. Handshake's `attach()` calls `migrateHostAwayFromBot` unconditionally so the first human to reconnect into a pre-seated rematch claims host. Hello emits a trailing `rematchReady` when the finished room already has a rematch mapping.

- [ ] **Step 1: Write failing dispatch tests**

Append to `server/tests/game/dispatch.test.ts`:

```ts
describe('dispatchMessage for requestRematch', () => {
  it('emits actionError when room is not finished', () => {
    const room = makeRoom();
    // Leave game null and phase 'waiting' — the typical dispatch precondition.
    const effects = dispatchMessage(room, 'sess-host', { type: 'requestRematch' }, { now: () => Date.now() });
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({ kind: 'sendTo', sessionId: 'sess-host' });
    const msg = (effects[0] as { kind: 'sendTo'; message: any }).message;
    expect(msg.type).toBe('actionError');
    expect(msg.reason).toBe('notFinished');
  });

  it('emits a createRematch effect when game is finished', () => {
    const room = makeRoom({ hostSessionId: 'sess-host' });
    room.phase = 'finished';
    room.game = {
      config: room.config,
      phase: 'finished',
      turnPhase: 'play',
      drawPile: [],
      completedBuildPiles: [],
      buildPiles: [],
      players: [
        { id: 'sess-host', name: 'Host', stockPile: [], hand: [], discardPiles: [[], [], [], []] },
      ],
      currentPlayerIndex: 0,
      winningTeamIndex: 0,
      stateVersion: 10,
    };
    const effects = dispatchMessage(room, 'sess-host', { type: 'requestRematch' }, { now: () => Date.now() });
    expect(effects).toHaveLength(1);
    expect(effects[0]).toEqual({ kind: 'createRematch', requesterSessionId: 'sess-host' });
  });
});
```

Make sure `makeRoom` is imported from the fixture file and `dispatchMessage` from `../../src/game/dispatch`.

- [ ] **Step 2: Run the failing dispatch tests**

```
cd server && npm test -- tests/game/dispatch.test.ts
```

Expected: 2 new tests fail.

- [ ] **Step 3: Extend `DispatchEffect` and the handler**

Edit `server/src/game/dispatch.ts`. Add a new effect variant:

```ts
export type DispatchEffect =
  | { kind: 'sendTo'; sessionId: string; message: ServerMessage }
  | { kind: 'broadcastState' }
  | { kind: 'broadcastChat'; chat: Extract<ServerMessage, { type: 'chat' }> }
  | { kind: 'afterCommit' }
  | { kind: 'createRematch'; requesterSessionId: string };
```

Add a branch near the top of `dispatchMessage` (before the existing `chat` and `action` branches) handling `requestRematch`:

```ts
if (msg.type === 'requestRematch') {
  const stateVersion = room.game?.stateVersion ?? 0;
  if (room.phase !== 'finished' || !room.game) {
    return [
      {
        kind: 'sendTo',
        sessionId,
        message: { type: 'actionError', reason: 'notFinished', stateVersion },
      },
    ];
  }
  return [{ kind: 'createRematch', requesterSessionId: sessionId }];
}
```

- [ ] **Step 4: Confirm dispatch tests pass**

```
cd server && npm test -- tests/game/dispatch.test.ts
```

Expected: full file green.

- [ ] **Step 5: Write failing integration tests for the connection + handshake**

Create `server/tests/game/rematch.test.ts`:

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

async function startFinishedRoom(h: Awaited<ReturnType<typeof startHarness>>) {
  // Create a 2-player room, start game, force-finish to get to phase=finished.
  const { room } = h.mgr.create({
    sessionId: 'sess-host', playerName: 'Host',
    config: { ruleset: 'recommended', stockPileSize: 5, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null },
    allowAiFill: false, visibility: 'public',
  });
  h.mgr.addMember(room.id, { sessionId: 'sess-guest', playerName: 'Guest' });
  h.mgr.startGame(room.id, { actorSessionId: 'sess-host' });
  // Simulate finish by flipping phase directly — real win path is out of scope.
  room.phase = 'finished';
  if (room.game) room.game.phase = 'finished';
  return room;
}

const harnesses: Array<Awaited<ReturnType<typeof startHarness>>> = [];
afterEach(async () => {
  while (harnesses.length > 0) await harnesses.pop()!.close();
});

describe('rematch wire protocol', () => {
  it('broadcasts rematchReady to every connected socket after requestRematch', async () => {
    const h = await startHarness();
    harnesses.push(h);
    const room = await startFinishedRoom(h);
    const host = await open(h.wsBase, room.id, 'sess-host');
    const guest = await open(h.wsBase, room.id, 'sess-guest');

    host.ws.send(JSON.stringify({ type: 'requestRematch' }));
    const hostReady = await waitForJson(host.ws, (m) => m.type === 'rematchReady');
    const guestReady = await waitForJson(guest.ws, (m) => m.type === 'rematchReady');
    expect(hostReady.newRoomId).toBeTruthy();
    expect(guestReady.newRoomId).toBe(hostReady.newRoomId);
    host.ws.close(); guest.ws.close();
  });

  it('second requestRematch returns the same newRoomId to the second requester only', async () => {
    const h = await startHarness();
    harnesses.push(h);
    const room = await startFinishedRoom(h);
    const host = await open(h.wsBase, room.id, 'sess-host');
    const guest = await open(h.wsBase, room.id, 'sess-guest');

    host.ws.send(JSON.stringify({ type: 'requestRematch' }));
    const hostReady = await waitForJson(host.ws, (m) => m.type === 'rematchReady');
    const guestReady = await waitForJson(guest.ws, (m) => m.type === 'rematchReady');
    expect(guestReady.newRoomId).toBe(hostReady.newRoomId);

    guest.ws.send(JSON.stringify({ type: 'requestRematch' }));
    // Guest receives the echo; host does NOT receive a second rematchReady.
    const secondGuest = await waitForJson(guest.ws, (m) => m.type === 'rematchReady');
    expect(secondGuest.newRoomId).toBe(hostReady.newRoomId);
    host.ws.close(); guest.ws.close();
  });

  it('emits actionError when game is not finished', async () => {
    const h = await startHarness();
    harnesses.push(h);
    const { room } = h.mgr.create({
      sessionId: 'sess-host', playerName: 'Host',
      config: { ruleset: 'recommended', stockPileSize: 5, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null },
      allowAiFill: false, visibility: 'public',
    });
    h.mgr.joinByCode({ sessionId: 'sess-guest', playerName: 'Guest', code: room.code });
    h.mgr.startGame({ roomId: room.id, sessionId: 'sess-host' });
    const host = await open(h.wsBase, room.id, 'sess-host');

    host.ws.send(JSON.stringify({ type: 'requestRematch' }));
    const err = await waitForJson(host.ws, (m) => m.type === 'actionError');
    expect(err.reason).toBe('notFinished');
    host.ws.close();
  });

  it('first human to attach in the rematch room claims host', async () => {
    const h = await startHarness();
    harnesses.push(h);
    const room = await startFinishedRoom(h);
    const host = await open(h.wsBase, room.id, 'sess-host');
    host.ws.send(JSON.stringify({ type: 'requestRematch' }));
    const ready = await waitForJson(host.ws, (m) => m.type === 'rematchReady');
    host.ws.close();

    // Open guest FIRST in the new room — they should claim host.
    const guest = await open(h.wsBase, ready.newRoomId, 'sess-guest');
    expect(guest.firstMsg.type).toBe('hello');
    const seats = guest.firstMsg.view.seats as Array<{ slotIndex: number; isHost: boolean; connected: boolean }>;
    const guestSeat = seats.find((s) => s.slotIndex === 1);
    const hostSeat = seats.find((s) => s.slotIndex === 0);
    expect(guestSeat?.connected).toBe(true);
    expect(hostSeat?.connected).toBe(false);
    expect(guestSeat?.isHost).toBe(true);
    expect(hostSeat?.isHost).toBe(false);
    guest.ws.close();
  });
});
```

- [ ] **Step 6: Run the failing integration tests**

```
cd server && npm test -- tests/game/rematch.test.ts
```

Expected: the `broadcast`, `idempotent second request`, and `first human to attach claims host` cases fail (no handler yet). The `actionError when not finished` case may already pass because Step 3's dispatch change forwards a `sendTo` effect through the existing connection effect loop. The remaining three fail until Steps 7–8 land.

- [ ] **Step 7: Implement the connection handler for the new effect**

Edit `server/src/game/connection.ts`. In the `handleMessage` effect loop, add a branch for `kind === 'createRematch'`:

```ts
} else if (e.kind === 'createRematch') {
  this.handleRematchRequest(e.requesterSessionId);
}
```

Add a new method:

```ts
private handleRematchRequest(requesterSessionId: string): void {
  const existing = this.registry.getRematchRoomId(this.room.id);
  if (existing) {
    // Idempotent: re-send to the requester only. Other sockets already
    // saw the original broadcast.
    const conn = this.registry.findBySession(this.room.id, requesterSessionId);
    conn?.send({ type: 'rematchReady', newRoomId: existing } satisfies ServerMessage);
    return;
  }
  const seatedHumans = this.room.slots
    .map((slot, i) => ({ slot, i }))
    .filter((x) => x.slot.kind === 'human')
    .map((x) => {
      const s = x.slot as Extract<typeof x.slot, { kind: 'human' }>;
      return { sessionId: s.sessionId, name: s.name, slotIndex: x.i };
    });
  const { room: rematch } = this.manager.createRematchRoom({ sourceRoom: this.room, seatedHumans });
  this.registry.setRematchRoomId(this.room.id, rematch.id);
  this.registry.broadcast(this.room.id, { type: 'rematchReady', newRoomId: rematch.id } satisfies ServerMessage);
}
```

- [ ] **Step 8: Add attach-time host migration**

Still in `connection.ts`, find `attach()`. After the existing line `this.registry.add(this.room.id, this);` (around line 98) and BEFORE `this.sendHello();`, add:

```ts
// First human to attach into a pre-seated rematch room claims host via
// the existing migrateHostAwayFromBot path. No-op in normal (non-rematch)
// flows because the host seat is not bot-controlled unless grace expired.
const newHost = this.manager.migrateHostAwayFromBot(this.room);
if (newHost) this.log.info({ newHost, from: this.sessionId }, 'hostClaimedOnAttach');
```

- [ ] **Step 9: Run the integration tests**

```
cd server && npm test -- tests/game/rematch.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 10: Run full server tests + typecheck**

```
cd server && npm test
cd server && npx tsc --noEmit
```

Expected: full suite green (including all previously-passing tests). Typecheck clean.

- [ ] **Step 11: Commit**

```
git add server/src/game/dispatch.ts server/src/game/connection.ts \
         server/tests/game/dispatch.test.ts server/tests/game/rematch.test.ts
git commit -m "Wire requestRematch server handler, hello re-emit, host claim"
```

---

## Phase 3: New UI components (parallel after Task 1.1)

### Task 3.1: WinModal component

**Depends on:** Task 0.1, Task 1.1.

**Files:**
- Create: `src/components/WinModal.tsx`

**Purpose:** Presentational overlay shown when the game is finished. Two CTAs: "Back to lobby" and "Keep same group". The rematch button transitions through three states (idle → creating → ready) as `rematchRoomId` flips and the parent invokes `onRequestRematch`.

- [ ] **Step 1: Read the existing modal styles**

Open `src/components/NewGameModal.tsx` and `src/components/ConfirmDialog.tsx` to match the shared overlay/typography/button treatment. Reuse the `[var(--gold)]` accent and `wood-frame` class.

- [ ] **Step 2: Implement the component**

Create `src/components/WinModal.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { SeatViewModel } from '@/lib/view/seat';

export interface WinModalProps {
  open: boolean;
  phase: 'playing' | 'finished' | 'waiting';
  endedReason: 'winner' | 'abandoned' | null;
  winningTeamIndex: number | null;
  partnershipTeams: number[][] | null;
  seats: SeatViewModel[];
  rematchRoomId: string | null;
  onRequestRematch: () => void;
  onBackToLobby: () => void;
}

export default function WinModal(props: WinModalProps) {
  const {
    open, phase, endedReason, winningTeamIndex, partnershipTeams, seats,
    rematchRoomId, onRequestRematch, onBackToLobby,
  } = props;
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (!open) setRequested(false);
  }, [open]);

  useEffect(() => {
    if (rematchRoomId) setRequested(false);
  }, [rematchRoomId]);

  if (!open || phase !== 'finished') return null;

  const headline = buildHeadline(endedReason, winningTeamIndex, partnershipTeams, seats);

  const rematchLabel = rematchRoomId
    ? 'Enter rematch →'
    : requested
      ? 'Creating rematch…'
      : 'Keep same group';

  const rematchDisabled = requested && !rematchRoomId;

  const handleRematchClick = () => {
    if (rematchRoomId) return; // Link takes over in JSX below.
    setRequested(true);
    onRequestRematch();
  };

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Game finished"
    >
      <div className="wood-frame rounded-2xl p-4 sm:p-5 max-w-md w-full">
        <div className="bg-black/30 rounded-xl p-6 ring-1 ring-white/10 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-widest text-[var(--gold)] mb-3">
            {headline.title}
          </h2>
          {headline.subtitle && (
            <p className="text-sm text-white/80 mb-6">{headline.subtitle}</p>
          )}

          <div className="mt-4 flex flex-col sm:flex-row gap-2 sm:gap-3 justify-center">
            <button
              type="button"
              onClick={onBackToLobby}
              className="bg-black/40 hover:bg-black/55 border border-white/15 px-4 py-2 rounded text-white text-sm"
            >
              Back to lobby
            </button>
            {rematchRoomId ? (
              <Link
                href={`/rooms/${rematchRoomId}`}
                className="bg-[var(--gold)] text-stone-900 font-semibold hover:brightness-110 px-4 py-2 rounded text-sm"
              >
                {rematchLabel}
              </Link>
            ) : (
              <button
                type="button"
                onClick={handleRematchClick}
                disabled={rematchDisabled}
                className="bg-[var(--gold)] text-stone-900 font-semibold hover:brightness-110 px-4 py-2 rounded text-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {rematchLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface Headline {
  title: string;
  subtitle: string | null;
}

function buildHeadline(
  endedReason: WinModalProps['endedReason'],
  winningTeamIndex: number | null,
  partnershipTeams: number[][] | null,
  seats: SeatViewModel[],
): Headline {
  if (endedReason === 'abandoned') {
    return { title: 'Game abandoned', subtitle: 'The remaining players have left the game.' };
  }
  if (winningTeamIndex === null) {
    return { title: 'Game over', subtitle: null };
  }
  if (partnershipTeams && partnershipTeams.length > 0) {
    const teamMembers = (partnershipTeams[winningTeamIndex] ?? []).map((slot) => {
      const seat = seats.find((s) => s.slotIndex === slot);
      return seat?.name ?? `Slot ${slot}`;
    });
    return {
      title: `TEAM ${winningTeamIndex + 1} WINS`,
      subtitle: teamMembers.join(' & '),
    };
  }
  const winner = seats.find((s) => s.slotIndex === winningTeamIndex);
  const name = winner?.name ?? `Slot ${winningTeamIndex}`;
  return { title: `${name.toUpperCase()} WINS`, subtitle: null };
}
```

- [ ] **Step 3: Run the typecheck**

```
npx tsc --noEmit
```

Expected: clean (except known `@engine/*` errors inside `server/`).

- [ ] **Step 4: Run tests**

```
npm test
```

Expected: all existing tests still pass.

- [ ] **Step 5: Commit**

```
git add src/components/WinModal.tsx
git commit -m "Create WinModal with back-to-lobby and rematch CTAs"
```

---

### Task 3.2: Seat refactor with backward-compatible wrapper

**Depends on:** Task 1.1.

**Files:**
- Modify: `src/components/Seat.tsx`

**Purpose:** Add a new render function that consumes `SeatViewModel`, keep the existing `PlayerState`-based `Seat` as a thin adapter that builds a `SeatViewModel` inline and delegates. This lets Task 4.1 create Board using the new render while `/local` keeps compiling until Task 5.2.

- [ ] **Step 1: Read the current Seat.tsx**

Current props:

```ts
interface SeatProps {
  position?: SeatPosition;
  player: PlayerState;
  playerIndex: number;
  isActive: boolean;
  isYou: boolean;
  teamIndex: number | null;
  teamColor: string | null;
  selection: SeatSelection;
  cardSize?: 'sm' | 'md';
  onSelectHand?: (idx: number) => void;
  onSelectStock?: () => void;
  onSelectDiscard?: (pileIdx: number) => void;
  onClickDiscardTarget?: (pileIdx: number) => void;
}
```

`player.hand`, `player.stockPile`, `player.discardPiles`, `player.name` are used for rendering. `playerIndex` is used in drag source ids.

- [ ] **Step 2: Refactor the render into a `SeatView` component**

Rewrite `src/components/Seat.tsx` as follows. Keep `SeatSelection` and the default export stable; add a new named export `SeatView`.

```tsx
'use client';

import Card from '@/components/Card';
import DraggableCard from '@/components/DraggableCard';
import DroppableZone from '@/components/DroppableZone';
import { Card as CardType, PlayerState } from '@/lib/game/types';
import { SeatPosition } from '@/lib/layout/seating';
import type { SeatViewModel } from '@/lib/view/seat';

export type SeatSelection =
  | { kind: 'none' }
  | { kind: 'hand'; index: number }
  | { kind: 'stock' }
  | { kind: 'discard'; pileIndex: number };

export interface SeatViewProps {
  position?: SeatPosition;
  seat: SeatViewModel;
  selection: SeatSelection;
  cardSize?: 'sm' | 'md';
  onSelectHand?: (idx: number) => void;
  onSelectStock?: () => void;
  onSelectDiscard?: (pileIdx: number) => void;
  onClickDiscardTarget?: (pileIdx: number) => void;
}

export function SeatView(props: SeatViewProps) {
  const {
    position, seat, selection, cardSize = 'md',
    onSelectHand, onSelectStock, onSelectDiscard, onClickDiscardTarget,
  } = props;

  const stockTop = seat.stockTop;

  const orientation = !position
    ? 'rotate-0'
    : position.side === 'top'
      ? 'rotate-180'
      : position.side === 'left'
        ? '-rotate-90'
        : position.side === 'right'
          ? 'rotate-90'
          : 'rotate-0';

  const activeRing = seat.isActive
    ? 'ring-2 ring-[var(--gold)] shadow-[0_0_24px_rgba(217,164,65,0.45)]'
    : 'ring-1 ring-black/30';

  const body = (
    <div className={`${orientation} origin-center`}>
      <div
        className={`relative rounded-xl ${activeRing} px-3 py-2 sm:px-4 sm:py-3 backdrop-blur-[1px]`}
        style={{
          background: 'rgba(0, 0, 0, 0.35)',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05)',
        }}
      >
        {seat.team && (
          <div
            className="absolute -top-1 left-3 right-3 h-1 rounded-full"
            style={{ background: seat.team.color }}
          />
        )}

        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white tracking-wide">
              {seat.name}
            </span>
            {seat.team && (
              <span
                className="text-[10px] uppercase px-1.5 py-0.5 rounded font-bold tracking-wider"
                style={{ background: seat.team.color, color: '#1a1a1a' }}
              >
                Team {seat.team.index + 1}
              </span>
            )}
            {seat.isHost && (
              <span className="text-[10px] uppercase text-[var(--gold)] font-bold tracking-wider">
                host
              </span>
            )}
          </div>
          {seat.isActive && (
            <span className="text-[10px] uppercase text-[var(--gold)] font-bold tracking-widest">
              ↻ turn
            </span>
          )}
        </div>

        <div className="flex items-end gap-2 sm:gap-4 flex-wrap sm:flex-nowrap">
          <div className="flex flex-col items-center gap-1">
            {stockTop ? (
              <DraggableCard
                id={`stock-${seat.slotIndex}`}
                source={{ from: 'stock', playerIndex: seat.slotIndex }}
                disabled={!seat.isActive || !seat.isYou}
                card={stockTop as CardType}
                size={cardSize}
                highlighted={seat.isActive && selection.kind === 'stock'}
                onClick={seat.isActive && seat.isYou ? onSelectStock : undefined}
                stacked={seat.stockCount}
              />
            ) : (
              <Card card={null} size={cardSize} label="empty" />
            )}
            <span className="text-[10px] text-white/70 tracking-widest">
              STOCK · {seat.stockCount}
            </span>
          </div>

          <div className="flex flex-col items-center gap-1 min-w-0 flex-1">
            <div className="flex gap-1 overflow-x-auto max-w-full pb-1">
              {seat.handCount === 0 && (
                <div className="text-xs text-white/40 italic px-4">empty hand</div>
              )}
              {seat.handCards !== null
                ? seat.handCards.map((c, i) => (
                    <DraggableCard
                      key={c.id}
                      id={`hand-${seat.slotIndex}-${i}`}
                      source={{ from: 'hand', index: i }}
                      disabled={!seat.isActive || !seat.isYou}
                      card={c}
                      size={cardSize}
                      highlighted={
                        seat.isActive && selection.kind === 'hand' && selection.index === i
                      }
                      onClick={seat.isActive && seat.isYou ? () => onSelectHand?.(i) : undefined}
                    />
                  ))
                : Array.from({ length: seat.handCount }).map((_, i) => (
                    <Card key={`hand-back-${i}`} card={null} faceDown size={cardSize} />
                  ))}
            </div>
            <span className="text-[10px] text-white/70 tracking-widest">
              HAND · {seat.handCount}
            </span>
          </div>

          <div className="flex flex-col items-center gap-1">
            <div className="flex gap-1">
              {seat.discardPiles.map((pile, i) => {
                const top = pile[pile.length - 1] ?? null;
                const isSelected =
                  seat.isActive && selection.kind === 'discard' && selection.pileIndex === i;
                const handleClick = seat.isActive && seat.isYou
                  ? () => {
                      if (selection.kind === 'hand') {
                        onClickDiscardTarget?.(i);
                      } else {
                        onSelectDiscard?.(i);
                      }
                    }
                  : undefined;
                const card = top ? (
                  <DraggableCard
                    id={`discard-src-${seat.slotIndex}-${i}`}
                    source={{ from: 'discard', playerIndex: seat.slotIndex, pileIndex: i }}
                    disabled={!seat.isActive || !seat.isYou || selection.kind === 'hand'}
                    card={top as CardType}
                    size="sm"
                    highlighted={isSelected}
                    stacked={pile.length}
                    onClick={handleClick}
                  />
                ) : (
                  <Card card={null} size="sm" label="" onClick={handleClick} />
                );
                return (
                  <div key={i} className="flex flex-col items-center gap-0.5">
                    {seat.isActive && seat.isYou ? (
                      <DroppableZone
                        id={`discard-target-${seat.slotIndex}-${i}`}
                        data={{ kind: 'discard', index: i }}
                      >
                        {card}
                      </DroppableZone>
                    ) : (
                      card
                    )}
                    <span className="text-[9px] text-white/50">{pile.length}</span>
                  </div>
                );
              })}
            </div>
            <span className="text-[10px] text-white/70 tracking-widest">DISCARD</span>
          </div>
        </div>
      </div>
    </div>
  );

  if (!position) return body;
  return (
    <div
      className="absolute"
      style={{
        left: `${position.xPct}%`,
        top: `${position.yPct}%`,
        transform: 'translate(-50%, -50%)',
      }}
    >
      {body}
    </div>
  );
}

// Backward-compatible wrapper — `/local` still passes PlayerState-based props
// until Task 5.2 migrates it to Board. Strip in Task 6.1 once the last caller
// is gone.
export interface SeatProps {
  position?: SeatPosition;
  player: PlayerState;
  playerIndex: number;
  isActive: boolean;
  isYou: boolean;
  teamIndex: number | null;
  teamColor: string | null;
  selection: SeatSelection;
  cardSize?: 'sm' | 'md';
  onSelectHand?: (idx: number) => void;
  onSelectStock?: () => void;
  onSelectDiscard?: (pileIdx: number) => void;
  onClickDiscardTarget?: (pileIdx: number) => void;
}

export default function Seat(props: SeatProps) {
  const seat: SeatViewModel = {
    slotIndex: props.playerIndex,
    name: props.player.name,
    handCards: props.isYou ? props.player.hand : null,
    handCount: props.player.hand.length,
    stockTop: props.player.stockPile.length > 0
      ? { id: props.player.stockPile[props.player.stockPile.length - 1]!.id, value: props.player.stockPile[props.player.stockPile.length - 1]!.value }
      : null,
    stockCount: props.player.stockPile.length,
    discardPiles: props.player.discardPiles.map((pile) => pile.map((c) => ({ id: c.id, value: c.value }))),
    team: props.teamIndex !== null && props.teamColor !== null
      ? { index: props.teamIndex, color: props.teamColor }
      : null,
    isActive: props.isActive,
    isYou: props.isYou,
    isHost: false,
    presence: 'online',
  };
  return (
    <SeatView
      position={props.position}
      seat={seat}
      selection={props.selection}
      cardSize={props.cardSize}
      onSelectHand={props.onSelectHand}
      onSelectStock={props.onSelectStock}
      onSelectDiscard={props.onSelectDiscard}
      onClickDiscardTarget={props.onClickDiscardTarget}
    />
  );
}
```

- [ ] **Step 3: Run typecheck + tests + lint**

```
npm test
npx tsc --noEmit
npm run lint
```

Expected: no new failures. The existing `/local/page.tsx` keeps working via the default-export wrapper.

- [ ] **Step 4: Commit**

```
git add src/components/Seat.tsx
git commit -m "Extract SeatView and keep Seat as backward-compat wrapper"
```

---

### Task 3.3: MobileBoard refactor with backward-compatible wrapper

**Depends on:** Task 1.1.

**Files:**
- Modify: `src/components/MobileBoard.tsx`
- Modify: `src/components/MobileOpponentStrip.tsx`

**Purpose:** Mirror Task 3.2 for the compact/mobile layout. Refactor `MobileOpponentStrip` to consume `SeatViewModel`. Refactor `MobileBoard` to have an inner `MobileBoardView` that takes the new wire-shaped props, and keep a default export wrapper that adapts the old `GameState`-based call site so `/local` keeps building until Task 5.2.

- [ ] **Step 1: Refactor `MobileOpponentStrip.tsx`**

Replace the entire file `src/components/MobileOpponentStrip.tsx` with:

```tsx
'use client';

import Card from '@/components/Card';
import type { SeatViewModel } from '@/lib/view/seat';

export interface MobileOpponentStripProps {
  seat: SeatViewModel;
}

export default function MobileOpponentStrip({ seat }: MobileOpponentStripProps) {
  return (
    <div
      className="relative rounded-lg px-2 py-1.5 flex items-center gap-2"
      style={{
        background: 'rgba(0, 0, 0, 0.35)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05)',
      }}
    >
      {seat.team && (
        <div
          className="absolute -top-0.5 left-2 right-2 h-0.5 rounded-full"
          style={{ background: seat.team.color }}
        />
      )}

      <div className="flex flex-col justify-center min-w-0 shrink-0">
        <span className="text-[11px] font-semibold text-white truncate">{seat.name}</span>
        <span className="text-[9px] text-white/60 uppercase tracking-wider">
          h:{seat.handCount} · s:{seat.stockCount}
          {seat.team !== null && ` · T${seat.team.index + 1}`}
          {seat.isHost && ' · host'}
        </span>
      </div>

      <div className="shrink-0">
        {seat.stockTop ? (
          <Card card={seat.stockTop} size="sm" stacked={seat.stockCount} />
        ) : (
          <Card card={null} size="sm" label="—" />
        )}
      </div>

      <div className="flex gap-1 ml-auto">
        {seat.discardPiles.map((pile, i) => {
          const top = pile[pile.length - 1] ?? null;
          return (
            <div key={i} className="flex flex-col items-center gap-0.5">
              <Card card={top} size="sm" stacked={pile.length} />
              <span className="text-[8px] text-white/50 leading-none">{pile.length}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `MobileBoard.tsx` with a `MobileBoardView` inner component plus a backward-compat default export**

Replace the entire file `src/components/MobileBoard.tsx` with:

```tsx
'use client';

import Card from '@/components/Card';
import DraggableCard from '@/components/DraggableCard';
import DroppableZone from '@/components/DroppableZone';
import MobileOpponentStrip from '@/components/MobileOpponentStrip';
import WildDirectionPicker from '@/components/WildDirectionPicker';
import { Card as CardType, GameState, PlayerState } from '@/lib/game/types';
import { SeatSelection } from '@/components/Seat';
import type {
  PublicGameConfig,
  PublicPartnershipRules,
} from '@/lib/net/protocol';
import type { SeatViewModel } from '@/lib/view/seat';

export interface MobileBoardViewProps {
  self: SeatViewModel;
  opponents: SeatViewModel[];
  buildPiles: GameState['buildPiles'];
  drawPileCount: number;
  completedPileCount: number;
  config: PublicGameConfig;
  selection: SeatSelection;
  onSelectHand: (idx: number) => void;
  onSelectStock: () => void;
  onSelectDiscard: (pileIdx: number) => void;
  onClickBuildPile: (buildPileIndex: number) => void;
  onClickOwnDiscardPile: (pileIdx: number) => void;
  pendingWildBuildPileIndex: number | null;
  onPickWildDirection: (direction: 'asc' | 'desc') => void;
  onCancelWildPlay: () => void;
}

export function MobileBoardView(props: MobileBoardViewProps) {
  const {
    self, opponents, buildPiles, drawPileCount, completedPileCount, config, selection,
    onSelectHand, onSelectStock, onSelectDiscard, onClickBuildPile, onClickOwnDiscardPile,
    pendingWildBuildPileIndex, onPickWildDirection, onCancelWildPlay,
  } = props;
  void drawPileCount; void completedPileCount; // displayed in TableCenter on desktop; compact layout omits them.
  const emptyLabel = config.bidirectionalBuild ? '1/12/W' : '1/W';

  return (
    <div className="absolute inset-0 pt-[72px] pb-0 px-2 flex flex-col gap-2 max-w-3xl mx-auto left-0 right-0">
      <div className="flex flex-col gap-1.5 flex-1 min-h-0 overflow-y-auto pb-1">
        {opponents.map((seat) => (
          <MobileOpponentStrip key={seat.slotIndex} seat={seat} />
        ))}
      </div>

      <div className="flex flex-col gap-2 shrink-0 pb-2">
        <div
          className="relative rounded-lg px-2 py-2 flex items-start gap-2 justify-center"
          style={{
            background: 'radial-gradient(circle at 50% 35%, rgba(255,255,255,0.06), rgba(0,0,0,0.3))',
            boxShadow: 'inset 0 0 20px rgba(0,0,0,0.5)',
          }}
        >
          <div className="flex flex-col items-center gap-0.5 shrink-0">
            {self.stockTop ? (
              <DraggableCard
                id={`stock-${self.slotIndex}`}
                source={{ from: 'stock', playerIndex: self.slotIndex }}
                card={self.stockTop as CardType}
                size="md"
                highlighted={selection.kind === 'stock'}
                onClick={onSelectStock}
                stacked={self.stockCount}
              />
            ) : (
              <Card card={null} size="md" label="empty" />
            )}
            <span className="text-[9px] text-white/70 tracking-widest whitespace-nowrap">
              STOCK · {self.stockCount}
            </span>
          </div>

          <div className="w-px self-stretch bg-white/10 mx-1" />

          <div className="flex items-start gap-1">
            {buildPiles.map((pile, i) => {
              const top = pile.cards[pile.cards.length - 1] ?? null;
              const sub =
                pile.cards.length === 0
                  ? emptyLabel
                  : `${pile.direction === 'asc' ? '↑' : '↓'}${pile.cards.length}`;
              const isPendingWild = pendingWildBuildPileIndex === i;
              return (
                <DroppableZone
                  key={i}
                  id={`build-${i}`}
                  data={{ kind: 'build', index: i }}
                  className="flex flex-col items-center gap-0.5"
                >
                  {isPendingWild ? (
                    <WildDirectionPicker
                      size="md"
                      onPickAsc={() => onPickWildDirection('asc')}
                      onPickDesc={() => onPickWildDirection('desc')}
                      onCancel={onCancelWildPlay}
                    />
                  ) : (
                    <Card
                      card={top}
                      size="md"
                      stacked={pile.cards.length}
                      onClick={() => onClickBuildPile(i)}
                    />
                  )}
                  <span className="text-[9px] text-white/70 whitespace-nowrap">
                    {isPendingWild ? 'pick' : sub}
                  </span>
                </DroppableZone>
              );
            })}
          </div>
        </div>

        <div
          className="rounded-lg px-2 py-2 flex flex-col items-center gap-1"
          style={{
            background: 'rgba(0, 0, 0, 0.35)',
            boxShadow: self.team?.color
              ? `inset 0 2px 0 0 ${self.team.color}, inset 0 0 0 1px rgba(255,255,255,0.05)`
              : 'inset 0 0 0 1px rgba(255,255,255,0.05)',
          }}
        >
          <div className="flex items-center justify-between w-full">
            <span className="text-[11px] font-semibold text-white">
              {self.name}
              {self.isActive && <span className="text-[var(--gold)] ml-1">· your turn</span>}
            </span>
            <span className="text-[9px] text-white/60 uppercase tracking-wider">
              HAND · {self.handCount}
            </span>
          </div>
          <div className="flex gap-1 justify-center flex-wrap">
            {self.handCount === 0 && (
              <div className="text-xs text-white/40 italic py-4">empty hand</div>
            )}
            {self.handCards !== null &&
              self.handCards.map((c, i) => (
                <DraggableCard
                  key={c.id}
                  id={`hand-${self.slotIndex}-${i}`}
                  source={{ from: 'hand', index: i }}
                  card={c}
                  size="md"
                  highlighted={selection.kind === 'hand' && selection.index === i}
                  onClick={() => onSelectHand(i)}
                />
              ))}
          </div>
        </div>

        <div className="rounded-lg px-2 py-2 flex flex-col items-center gap-1 bg-black/30 ring-1 ring-white/5">
          <span className="text-[9px] text-white/60 uppercase tracking-wider w-full">
            DISCARD
          </span>
          <div className="flex gap-1 justify-center w-full">
            {self.discardPiles.map((pile, i) => {
              const top = pile[pile.length - 1] ?? null;
              const isSelected = selection.kind === 'discard' && selection.pileIndex === i;
              const card = top ? (
                <DraggableCard
                  id={`discard-src-${self.slotIndex}-${i}`}
                  source={{ from: 'discard', playerIndex: self.slotIndex, pileIndex: i }}
                  disabled={selection.kind === 'hand'}
                  card={top as CardType}
                  size="md"
                  highlighted={isSelected}
                  stacked={pile.length}
                  onClick={() => {
                    if (selection.kind === 'hand') onClickOwnDiscardPile(i);
                    else onSelectDiscard(i);
                  }}
                />
              ) : (
                <Card
                  card={null}
                  size="md"
                  onClick={() => {
                    if (selection.kind === 'hand') onClickOwnDiscardPile(i);
                  }}
                />
              );
              return (
                <div key={i} className="flex flex-col items-center gap-0.5">
                  <DroppableZone
                    id={`discard-target-${self.slotIndex}-${i}`}
                    data={{ kind: 'discard', index: i }}
                  >
                    {card}
                  </DroppableZone>
                  <span className="text-[9px] text-white/50">{pile.length}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// Backward-compat wrapper consumed by the current `/local/page.tsx` until
// Task 5.2 migrates it to Board. Removed in Task 6.1.
interface MobileBoardProps {
  state: GameState;
  activePlayer: PlayerState;
  activeIdx: number;
  selection: SeatSelection;
  teamColorFor: (id: string) => { index: number | null; color: string | null };
  opponents: { player: PlayerState; index: number }[];
  onSelectHand: (idx: number) => void;
  onSelectStock: () => void;
  onSelectDiscard: (pileIdx: number) => void;
  onClickBuildPile: (index: number) => void;
  onClickOwnDiscardPile: (pileIdx: number) => void;
  pendingWildBuildPileIndex?: number | null;
  onPickWildDirection?: (direction: 'asc' | 'desc') => void;
  onCancelWildPlay?: () => void;
}

export default function MobileBoard(props: MobileBoardProps) {
  const idToSlot = new Map<string, number>();
  props.state.players.forEach((p, i) => idToSlot.set(p.id, i));

  const toSeat = (player: PlayerState, slotIndex: number, isYou: boolean): SeatViewModel => {
    const team = props.teamColorFor(player.id);
    const stockTop = player.stockPile[player.stockPile.length - 1] ?? null;
    return {
      slotIndex,
      name: player.name,
      handCards: isYou ? player.hand : null,
      handCount: player.hand.length,
      stockTop: stockTop ? { id: stockTop.id, value: stockTop.value } : null,
      stockCount: player.stockPile.length,
      discardPiles: player.discardPiles.map((pile) =>
        pile.map((c) => ({ id: c.id, value: c.value })),
      ),
      team: team.index !== null && team.color !== null ? { index: team.index, color: team.color } : null,
      isActive: slotIndex === props.activeIdx,
      isYou,
      isHost: false,
      presence: 'online',
    };
  };

  const self = toSeat(props.activePlayer, props.activeIdx, true);
  const opponents = props.opponents.map(({ player, index }) => toSeat(player, index, false));

  // Strip seed and convert partnership teams from engine ids to slot indices so
  // the inner view sees the same PublicGameConfig shape as the networked path.
  const { seed: _seed, partnership, ...rest } = props.state.config;
  const publicPartnership: PublicPartnershipRules | null = partnership
    ? {
        ...partnership,
        teams: partnership.teams.map((team) => team.map((id) => idToSlot.get(id) ?? -1)),
      }
    : null;
  const config: PublicGameConfig = { ...rest, partnership: publicPartnership };

  return (
    <MobileBoardView
      self={self}
      opponents={opponents}
      buildPiles={props.state.buildPiles}
      drawPileCount={props.state.drawPile.length}
      completedPileCount={props.state.completedBuildPiles.length}
      config={config}
      selection={props.selection}
      onSelectHand={props.onSelectHand}
      onSelectStock={props.onSelectStock}
      onSelectDiscard={props.onSelectDiscard}
      onClickBuildPile={props.onClickBuildPile}
      onClickOwnDiscardPile={props.onClickOwnDiscardPile}
      pendingWildBuildPileIndex={props.pendingWildBuildPileIndex ?? null}
      onPickWildDirection={(direction) => props.onPickWildDirection?.(direction)}
      onCancelWildPlay={() => props.onCancelWildPlay?.()}
    />
  );
}
```

- [ ] **Step 3: Run typecheck + tests + lint**

```
npm test
npx tsc --noEmit
npm run lint
```

Expected: `/local` still renders via the backward-compat wrapper. Existing tests still pass.

- [ ] **Step 4: Commit**

```
git add src/components/MobileBoard.tsx src/components/MobileOpponentStrip.tsx
git commit -m "Refactor MobileBoard and strip to consume SeatViewModel"
```

---

## Phase 4: Board component

### Task 4.1: Create `Board.tsx` and narrow `TableCenter` config prop

**Depends on:** Task 3.1, Task 3.2, Task 3.3.

**Files:**
- Create: `src/components/Board.tsx`
- Modify: `src/components/TableCenter.tsx`

**Purpose:** The single presentational Board consumed by both drivers. Owns: `DragDropProvider`, selection state, wild picker state, end-turn confirm state, seat geometry, WinModal visibility. Accepts only the wire shape + callbacks — never an engine type. Widen `TableCenter`'s `config` prop to the structural minimum it actually uses so Board can pass either `GameConfig` or `PublicGameConfig` without casts.

- [ ] **Step 1: Narrow `TableCenter`'s `config` prop**

Open `src/components/TableCenter.tsx`. Change the `config` prop type from `GameConfig` to a structural minimum:

```ts
// BEFORE
import { BuildPile, GameConfig } from '@/lib/game/types';

interface TableCenterProps {
  // ...
  config: GameConfig;
  // ...
}
```

```ts
// AFTER
import { BuildPile } from '@/lib/game/types';

interface TableCenterProps {
  // ...
  config: { bidirectionalBuild: boolean };
  // ...
}
```

The only use of `config` in the file is `config.bidirectionalBuild`. Both the engine `GameConfig` and the wire `PublicGameConfig` satisfy `{ bidirectionalBuild: boolean }`, so existing callers keep working.

- [ ] **Step 2: Implement Board**

Create `src/components/Board.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';
import { MobileBoardView } from '@/components/MobileBoard';
import { SeatView, type SeatSelection } from '@/components/Seat';
import TableCenter from '@/components/TableCenter';
import WinModal from '@/components/WinModal';
import { DragDropProvider, DragSourceData, DropTargetData } from '@/lib/dnd';
import type { GameView, GameViewSeat, PlayerView } from '@/lib/net/protocol';
import type { CardSource, GameAction } from '@/lib/game/types';
import { WILD } from '@/lib/game/types';
import { buildSeatViewModels, type SeatViewModel } from '@/lib/view/seat';
import { getSeatPositions } from '@/lib/layout/seating';

const TEAM_COLORS = ['#eab308', '#0ea5e9', '#ec4899', '#84cc16'];

export interface BoardProps {
  view: PlayerView;
  seats: GameViewSeat[];
  onAction: (action: GameAction) => void;
  onRequestRematch: () => void;
  onBackToLobby: () => void;
  rematchRoomId: string | null;
  lastActionError: string | null;
  endedReason?: 'winner' | 'abandoned' | null;
}

interface PendingDiscard {
  handIndex: number;
  discardPileIndex: number;
  targetSlotIndex: number;
  cardLabel: string;
}

interface PendingWildPlay {
  source: CardSource;
  buildPileIndex: number;
}

export default function Board(props: BoardProps) {
  const {
    view, seats, onAction, onRequestRematch, onBackToLobby,
    rematchRoomId, lastActionError, endedReason = null,
  } = props;

  const seatModels = useMemo(
    () => buildSeatViewModels({ view, seats, teamColors: TEAM_COLORS }),
    [view, seats],
  );
  const players = seatModels;
  const activeSlot = view.currentPlayerSlotIndex;
  const youSlot = view.youSlotIndex;
  const isYourTurn = youSlot >= 0 && youSlot === activeSlot;

  const [selection, setSelection] = useState<SeatSelection>({ kind: 'none' });
  const [message, setMessage] = useState<string>('');
  const [pendingDiscard, setPendingDiscard] = useState<PendingDiscard | null>(null);
  const [pendingWildPlay, setPendingWildPlay] = useState<PendingWildPlay | null>(null);

  // Clear selection and pending modals on state-version bumps (turn changed,
  // server broadcast new state, etc.).
  useEffect(() => {
    setSelection({ kind: 'none' });
    setPendingDiscard(null);
    setPendingWildPlay(null);
  }, [view.stateVersion]);

  // Surface server-side actionError as a transient toast.
  useEffect(() => {
    if (!lastActionError) return;
    setMessage(lastActionError);
    const t = setTimeout(() => setMessage(''), 3000);
    return () => clearTimeout(t);
  }, [lastActionError]);

  const seatPositions = useMemo(() => getSeatPositions(players.length), [players.length]);
  const seatOf = (slotIndex: number) => {
    const rotated = (slotIndex - (youSlot < 0 ? 0 : youSlot) + players.length) % players.length;
    return seatPositions[rotated];
  };

  const you = players.find((p) => p.slotIndex === youSlot) ?? null;
  const useTableLayout = players.length <= 4;
  const partnershipTeams = view.config.partnership?.teams ?? null;

  const selectedCard = useMemo(() => {
    if (!you) return null;
    if (selection.kind === 'hand') return you.handCards?.[selection.index] ?? null;
    if (selection.kind === 'stock') return you.stockTop;
    if (selection.kind === 'discard') {
      const pile = you.discardPiles[selection.pileIndex] ?? [];
      return pile[pile.length - 1] ?? null;
    }
    return null;
  }, [selection, you]);

  const sourceFromSelection = (): CardSource | null => {
    if (selection.kind === 'hand') return { from: 'hand', index: selection.index };
    if (selection.kind === 'stock') return { from: 'stock', playerIndex: youSlot };
    if (selection.kind === 'discard') {
      return { from: 'discard', playerIndex: youSlot, pileIndex: selection.pileIndex };
    }
    return null;
  };

  const tryPlayToBuild = (source: CardSource, buildPileIndex: number) => {
    const pile = view.buildPiles[buildPileIndex];
    const isEmpty = pile ? pile.cards.length === 0 : true;
    const card = resolveSourceCard(source, view);
    if (isEmpty && view.config.bidirectionalBuild && card?.value === WILD) {
      setPendingWildPlay({ source, buildPileIndex });
      return;
    }
    onAction({ type: 'PLAY_TO_BUILD', source, buildPileIndex });
  };

  const resolvePendingWild = (direction: 'asc' | 'desc') => {
    if (!pendingWildPlay) return;
    onAction({
      type: 'PLAY_TO_BUILD',
      source: pendingWildPlay.source,
      buildPileIndex: pendingWildPlay.buildPileIndex,
      declaredDirection: direction,
    });
    setPendingWildPlay(null);
  };
  const cancelPendingWild = () => setPendingWildPlay(null);

  const tryDiscard = (handIndex: number, pileIndex: number, targetSlotIndex: number) => {
    if (!you) return;
    const card = you.handCards?.[handIndex];
    if (!card) return;
    setPendingDiscard({
      handIndex,
      discardPileIndex: pileIndex,
      targetSlotIndex,
      cardLabel: card.value === WILD ? 'Skip-Bo (wild)' : String(card.value),
    });
  };

  const onClickBuildPile = (buildPileIndex: number) => {
    if (!isYourTurn) return;
    const source = sourceFromSelection();
    if (!source) {
      setMessage('select a card first');
      return;
    }
    tryPlayToBuild(source, buildPileIndex);
  };

  const onClickOwnDiscardPile = (pileIndex: number) => {
    if (!isYourTurn) return;
    if (selection.kind !== 'hand') {
      setMessage('select a hand card to discard');
      return;
    }
    tryDiscard(selection.index, pileIndex, youSlot);
  };

  const onDragEnd = useCallback(
    (source: DragSourceData, target: DropTargetData | null) => {
      if (!isYourTurn || !target) return;
      if (target.kind === 'build') {
        tryPlayToBuild(source.source, target.index);
        return;
      }
      if (target.kind === 'discard') {
        if (source.source.from !== 'hand') {
          setMessage('only hand cards can be discarded');
          return;
        }
        tryDiscard(source.source.index, target.index, youSlot);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isYourTurn, youSlot, view],
  );

  const confirmPendingDiscard = () => {
    if (!pendingDiscard) return;
    onAction({
      type: 'DISCARD',
      handIndex: pendingDiscard.handIndex,
      discardPileIndex: pendingDiscard.discardPileIndex,
      targetPlayerIndex: pendingDiscard.targetSlotIndex,
    });
    setPendingDiscard(null);
  };

  const currentSlotName = players.find((p) => p.slotIndex === activeSlot)?.name ?? `Slot ${activeSlot}`;
  const partnershipActive = !!view.config.partnership?.enabled;

  return (
    <DragDropProvider onDragEnd={onDragEnd}>
      <div className="wood-frame min-h-screen p-2 sm:p-3">
        <div className="felt-surface relative rounded-xl overflow-hidden h-[calc(100vh-24px)] sm:h-[calc(100vh-32px)]">
          <header className="absolute top-2 sm:top-3 left-3 right-3 sm:left-4 sm:right-4 z-20 flex items-center justify-between text-white gap-2">
            <h1 className="text-base sm:text-lg font-bold tracking-widest shrink-0">
              SKIP<span className="text-[var(--gold)]">·</span>BO
            </h1>
            <div
              className={`${useTableLayout ? 'hidden md:block' : 'hidden'} px-3 py-1 rounded-full border border-white/10 text-xs text-white/90 text-center mx-4 truncate max-w-xl`}
              style={{ background: 'rgba(0,0,0,0.45)' }}
            >
              {view.phase === 'finished' ? (
                <span className="text-[var(--gold)] font-bold tracking-wider">
                  {partnershipActive
                    ? `TEAM ${(view.winningTeamIndex ?? 0) + 1} WINS`
                    : `${currentSlotName.toUpperCase()} WINS`}
                </span>
              ) : (
                <span>
                  <span className="text-[var(--gold)] font-semibold">{currentSlotName}</span>{' '}
                  — {isYourTurn ? 'pick a card, then a target' : 'waiting for their move'}
                </span>
              )}
              {message && <span className="ml-3 text-red-300">{message}</span>}
            </div>
          </header>

          <div className={`${useTableLayout ? 'md:hidden' : ''} absolute top-10 left-2 right-2 z-10 flex justify-center pointer-events-none`}>
            <div
              className="px-3 py-1 rounded-full border border-white/10 text-[11px] text-white backdrop-blur-sm text-center"
              style={{ background: 'rgba(0,0,0,0.45)' }}
            >
              {view.phase === 'finished' ? (
                <span className="text-[var(--gold)] font-bold tracking-wider">
                  {partnershipActive
                    ? `TEAM ${(view.winningTeamIndex ?? 0) + 1} WINS`
                    : `${currentSlotName.toUpperCase()} WINS`}
                </span>
              ) : (
                <span>
                  <span className="text-[var(--gold)] font-semibold">{currentSlotName}</span>{' '}
                  — {isYourTurn ? 'pick a card' : 'waiting'}
                </span>
              )}
              {message && <span className="ml-3 text-red-300">{message}</span>}
            </div>
          </div>

          {useTableLayout && (
            <div className="hidden md:contents">
              <TableCenter
                buildPiles={view.buildPiles}
                drawPileCount={view.drawPileCount}
                completedPileCount={0}
                config={{ bidirectionalBuild: view.config.bidirectionalBuild }}
                onClickBuildPile={onClickBuildPile}
                pendingWildBuildPileIndex={pendingWildPlay?.buildPileIndex ?? null}
                onPickWildDirection={resolvePendingWild}
                onCancelWildPlay={cancelPendingWild}
              />
              {players.map((seat) => (
                <SeatView
                  key={seat.slotIndex}
                  position={seatOf(seat.slotIndex)}
                  seat={seat}
                  selection={seat.isYou ? selection : { kind: 'none' }}
                  cardSize={players.length > 4 ? 'sm' : 'md'}
                  onSelectHand={(idx) => {
                    if (!isYourTurn) return;
                    setSelection((prev) =>
                      prev.kind === 'hand' && prev.index === idx
                        ? { kind: 'none' }
                        : { kind: 'hand', index: idx },
                    );
                  }}
                  onSelectStock={() => {
                    if (!isYourTurn || !you || you.stockCount === 0) return;
                    setSelection((prev) => (prev.kind === 'stock' ? { kind: 'none' } : { kind: 'stock' }));
                  }}
                  onSelectDiscard={(pileIdx) => {
                    if (!isYourTurn || !you) return;
                    const pile = you.discardPiles[pileIdx];
                    if (!pile || pile.length === 0) return;
                    setSelection((prev) =>
                      prev.kind === 'discard' && prev.pileIndex === pileIdx
                        ? { kind: 'none' }
                        : { kind: 'discard', pileIndex: pileIdx },
                    );
                  }}
                  onClickDiscardTarget={onClickOwnDiscardPile}
                />
              ))}
            </div>
          )}

          {/* Compact layout — mobile always; desktop when > 4 players. */}
          <div className={useTableLayout ? 'md:hidden contents' : 'contents'}>
            {you && (
              <MobileBoardView
                self={you}
                opponents={players.filter((p) => p.slotIndex !== youSlot)}
                buildPiles={view.buildPiles}
                drawPileCount={view.drawPileCount}
                completedPileCount={0}
                config={view.config}
                selection={selection}
                onSelectHand={(idx) => {
                  if (!isYourTurn) return;
                  setSelection((prev) =>
                    prev.kind === 'hand' && prev.index === idx
                      ? { kind: 'none' }
                      : { kind: 'hand', index: idx },
                  );
                }}
                onSelectStock={() => {
                  if (!isYourTurn || !you || you.stockCount === 0) return;
                  setSelection((prev) => (prev.kind === 'stock' ? { kind: 'none' } : { kind: 'stock' }));
                }}
                onSelectDiscard={(pileIdx) => {
                  if (!isYourTurn || !you) return;
                  const pile = you.discardPiles[pileIdx];
                  if (!pile || pile.length === 0) return;
                  setSelection((prev) =>
                    prev.kind === 'discard' && prev.pileIndex === pileIdx
                      ? { kind: 'none' }
                      : { kind: 'discard', pileIndex: pileIdx },
                  );
                }}
                onClickBuildPile={onClickBuildPile}
                onClickOwnDiscardPile={onClickOwnDiscardPile}
                pendingWildBuildPileIndex={pendingWildPlay?.buildPileIndex ?? null}
                onPickWildDirection={resolvePendingWild}
                onCancelWildPlay={cancelPendingWild}
              />
            )}
          </div>
        </div>

        <ConfirmDialog
          open={!!pendingDiscard}
          title="End your turn?"
          body={
            pendingDiscard && (
              <span>
                Discard your {pendingDiscard.cardLabel} onto pile{' '}
                {pendingDiscard.discardPileIndex + 1} and pass to the next player.
              </span>
            )
          }
          confirmLabel="Discard & end turn"
          cancelLabel="Keep playing"
          destructive
          onConfirm={confirmPendingDiscard}
          onCancel={() => setPendingDiscard(null)}
        />

        <WinModal
          open={view.phase === 'finished'}
          phase={view.phase}
          endedReason={endedReason}
          winningTeamIndex={view.winningTeamIndex}
          partnershipTeams={partnershipTeams}
          seats={players}
          rematchRoomId={rematchRoomId}
          onRequestRematch={onRequestRematch}
          onBackToLobby={onBackToLobby}
        />
      </div>
    </DragDropProvider>
  );
}

function resolveSourceCard(source: CardSource, view: PlayerView) {
  if (source.from === 'hand') return view.you.hand[source.index] ?? null;
  if (source.from === 'stock') {
    if (source.playerIndex === view.youSlotIndex) {
      return view.you.stockPile[view.you.stockPile.length - 1] ?? null;
    }
    const op = view.opponents.find((o) => o.slotIndex === source.playerIndex);
    return op?.stockTop ?? null;
  }
  if (source.from === 'discard') {
    if (source.playerIndex === view.youSlotIndex) {
      const pile = view.you.discardPiles[source.pileIndex] ?? [];
      return pile[pile.length - 1] ?? null;
    }
    const op = view.opponents.find((o) => o.slotIndex === source.playerIndex);
    if (!op) return null;
    const pile = op.discardPiles[source.pileIndex] ?? [];
    return pile[pile.length - 1] ?? null;
  }
  return null;
}
```

- [ ] **Step 3: Run typecheck + tests + lint**

```
npm test
npx tsc --noEmit
npm run lint
```

Expected: no new failures. `/local` still renders via the existing Seat/MobileBoard wrappers (they pass `GameConfig` which still satisfies the widened `TableCenter` config prop).

- [ ] **Step 4: Commit**

```
git add src/components/Board.tsx src/components/TableCenter.tsx
git commit -m "Create Board component consuming wire shape via SeatView"
```

---

## Phase 5: Wire Board into both pages (parallel)

### Task 5.1: Rewrite `/rooms/[roomId]/page.tsx`

**Depends on:** Task 4.1, Task 1.5.

**Files:**
- Modify: `src/app/rooms/[roomId]/page.tsx`

**Purpose:** Replace the debug view with Board, wired to `socket.view` / `socket.sendAction` / `socket.requestRematch` / `socket.rematchRoomId`. Keep the existing Closed / Placeholder shells for pre-view states.

- [ ] **Step 1: Rewrite the page**

Replace `src/app/rooms/[roomId]/page.tsx` with:

```tsx
'use client';

import { use, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import Board from '@/components/Board';
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
  const router = useRouter();

  useEffect(() => {
    if (socket.rematchRoomId) {
      router.push(`/rooms/${socket.rematchRoomId}`);
    }
  }, [socket.rematchRoomId, router]);

  if (!sessionId) return <Frame><Placeholder>Waiting for session id…</Placeholder></Frame>;
  if (socket.status === 'closed') {
    return <Frame><Closed code={socket.lastError?.code} reason={socket.lastError?.reason} /></Frame>;
  }
  if (!socket.view) return <Frame><Placeholder>Opening game socket…</Placeholder></Frame>;

  const { view, seats } = socket.view;

  return (
    <Board
      view={view}
      seats={seats}
      onAction={socket.sendAction}
      onRequestRematch={socket.requestRematch}
      onBackToLobby={() => router.push('/')}
      rematchRoomId={socket.rematchRoomId}
      lastActionError={socket.lastActionError?.reason ?? null}
      endedReason={view.phase === 'finished' ? 'winner' : null}
    />
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen felt-surface flex items-start justify-center p-4 sm:p-10 overflow-auto">
      <div className="w-full max-w-2xl wood-frame rounded-xl p-6 sm:p-8 table-inset">
        <div className="bg-black/30 rounded-lg p-5 sm:p-6 ring-1 ring-white/5">{children}</div>
      </div>
    </main>
  );
}

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-white/55">
      <span className="w-2 h-2 rounded-full bg-amber-300/60 animate-pulse" />
      <span className="italic">{children}</span>
    </div>
  );
}

function Closed({ code, reason }: { code?: number; reason?: string }) {
  return (
    <div className="space-y-3">
      <h1 className="text-xl text-rose-200 font-semibold">Disconnected</h1>
      <div className="text-sm text-white/70">
        <span className="font-mono text-rose-200/80">close {code ?? '?'}</span>
        {reason ? <span className="ml-2 text-white/50">— {reason}</span> : null}
      </div>
      <p className="text-xs text-white/45">This close code is terminal; reload the page to try again.</p>
    </div>
  );
}
```

- [ ] **Step 2: Run typecheck + tests + lint**

```
npm test
npx tsc --noEmit
npm run lint
```

- [ ] **Step 3: Manual sanity**

Start the server: `cd server && npm run build && npm start`. In another terminal with `.env.local` containing `NEXT_PUBLIC_GAME_WS_URL=ws://localhost:8787`, run `npm run dev`. Create a room via REST, seat two humans, start the game, open `/rooms/<roomId>` in two tabs. Confirm the Board renders and a card drag from hand to build pile round-trips through the server.

(Automated WS-integration tests for the frontend page are deferred to Section 8 per the spec — manual sanity here is acceptable.)

- [ ] **Step 4: Commit**

```
git add src/app/rooms/[roomId]/page.tsx
git commit -m "Render Board on networked room page via useGameSocket"
```

---

### Task 5.2: Rewrite `/local/page.tsx`

**Depends on:** Task 4.1, Task 1.2.

**Files:**
- Modify: `src/app/local/page.tsx`

**Purpose:** Replace the in-file Board with a consumer of the new `Board` component, feeding it via `engineStateToView`. Hot-seat semantics: `youPlayerIndex` always equals the active player. "Keep same group" restarts the game with the last-used settings.

- [ ] **Step 1: Rewrite the page**

Replace `src/app/local/page.tsx` with:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Board from '@/components/Board';
import NewGameModal, {
  NewGameSettings,
  buildPartnershipFromSettings,
  settingsToConfigOverrides,
} from '@/components/NewGameModal';
import RulesetInfo from '@/components/RulesetInfo';
import { applyAction, createGame } from '@/lib/game/engine';
import type { GameAction, GameState } from '@/lib/game/types';
import { engineStateToView } from '@/lib/view/fromEngine';

const DEFAULT_SETTINGS: NewGameSettings = {
  playerCount: 2,
  ruleset: 'recommended',
  stockPileSize: 15,
  handSize: 5,
  bidirectionalBuild: true,
  partnership: { mode: 'none', teams: [] },
};

function makeGameFromSettings(settings: NewGameSettings): GameState {
  const players = Array.from({ length: settings.playerCount }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
  }));
  return createGame({
    players,
    ruleset: settings.ruleset,
    overrides: settingsToConfigOverrides(settings),
    partnership: buildPartnershipFromSettings(settings, players.map((p) => p.id)),
  });
}

export default function LocalHome() {
  const router = useRouter();
  const [state, setState] = useState<GameState | null>(null);
  const [settings, setSettings] = useState<NewGameSettings>(DEFAULT_SETTINGS);
  const [newGameOpen, setNewGameOpen] = useState(false);
  const [rulesetOpen, setRulesetOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setState((prev) => prev ?? makeGameFromSettings(DEFAULT_SETTINGS));
  }, []);

  const dispatch = useCallback(
    (action: GameAction) => {
      setState((current) => {
        if (!current) return current;
        const result = applyAction(current, action);
        if (!result.ok) {
          setActionError(result.error);
          return current;
        }
        setActionError(null);
        return result.state;
      });
    },
    [],
  );

  const handleStartNew = useCallback((next: NewGameSettings) => {
    setSettings(next);
    setState(makeGameFromSettings(next));
    setActionError(null);
    setNewGameOpen(false);
  }, []);

  const handleRematch = useCallback(() => {
    setState(makeGameFromSettings(settings));
    setActionError(null);
  }, [settings]);

  if (!state) {
    return (
      <div className="wood-frame min-h-screen p-2 sm:p-3">
        <div className="felt-surface relative rounded-xl overflow-hidden h-[calc(100vh-24px)] sm:h-[calc(100vh-32px)]" />
      </div>
    );
  }

  const { view, seats } = engineStateToView(state, state.currentPlayerIndex);

  return (
    <>
      <Board
        view={view}
        seats={seats}
        onAction={dispatch}
        onRequestRematch={handleRematch}
        onBackToLobby={() => router.push('/')}
        rematchRoomId={null}
        lastActionError={actionError}
        endedReason={state.phase === 'finished' ? 'winner' : null}
      />
      <NewGameModal
        open={newGameOpen}
        onCancel={() => setNewGameOpen(false)}
        onStart={handleStartNew}
        defaultPlayerCount={state.players.length}
      />
      <RulesetInfo
        open={rulesetOpen}
        onClose={() => setRulesetOpen(false)}
        config={state.config}
        playerNames={state.players.map((p) => p.name)}
      />
    </>
  );
}
```

Note: the original `/local` had in-board buttons for "ruleset" and "New Game" in the header. They are OUT of scope for Board (which is shared with networked). A follow-up may re-introduce them via Board slots; for now, the /local wrapper can render its own lightweight top-bar above the Board if you want to preserve parity — but not required to satisfy Section 6's spec. If preserving, add a minimal fixed-position button bar; if not, users still get "New Game" via the WinModal rematch button on game end.

The acceptable minimum for this task is: game playable, Win modal rematch restarts, no regressions in drag-drop and turn flow.

- [ ] **Step 2: Run typecheck + tests + lint**

```
npm test
npx tsc --noEmit
npm run lint
```

- [ ] **Step 3: Manual sanity**

`npm run dev`. Visit `/local`. Play one full round with 2 players (recommended ruleset). Discard to advance turn. Confirm win condition renders WinModal with correct headline and "Keep same group" restarts the game.

- [ ] **Step 4: Commit**

```
git add src/app/local/page.tsx
git commit -m "Render Board on local page via engineStateToView"
```

---

## Phase 6: Remove backward-compat wrappers

### Task 6.1: Drop PlayerState-based Seat / MobileBoard exports

**Depends on:** Task 5.1, Task 5.2.

**Files:**
- Modify: `src/components/Seat.tsx`
- Modify: `src/components/MobileBoard.tsx`

**Purpose:** After /local and /rooms both consume the new Board, no caller uses the PlayerState-shaped wrappers added in Tasks 3.2 and 3.3. Remove them so the component surface stays focused.

- [ ] **Step 1: Verify nothing imports the old `default export Seat` or `default export MobileBoard`**

```
grep -rn "from '@/components/Seat'" src/ || true
grep -rn "from '@/components/MobileBoard'" src/ || true
```

Expected: both greps show imports only from `@/components/Board.tsx` (which imports `SeatView` and `MobileBoardView`). No other files should import the default exports.

If any stragglers remain, STOP and open a clarification — it likely means Task 5.x is incomplete.

- [ ] **Step 2: Strip the wrapper from `Seat.tsx`**

Open `src/components/Seat.tsx`. Delete everything from `// Backward-compatible wrapper …` through the closing `}` of `export default function Seat(...)`. Then change the `export function SeatView(...)` declaration to `export default function SeatView(...)` so `SeatView` becomes the default export. The `SeatSelection` type export and the `SeatViewProps` interface stay as named exports.

In `src/components/Board.tsx`, change the import from:

```ts
import { SeatView, type SeatSelection } from '@/components/Seat';
```

to:

```ts
import SeatView, { type SeatSelection } from '@/components/Seat';
```

- [ ] **Step 3: Strip the wrapper from `MobileBoard.tsx`**

Open `src/components/MobileBoard.tsx`. Delete everything from `// Backward-compat wrapper …` through the closing `}` of `export default function MobileBoard(...)`. Delete the now-unused imports `GameState`, `PlayerState`, `PublicPartnershipRules` (they were only used by the wrapper). Change `export function MobileBoardView(...)` to `export default function MobileBoardView(...)`. Keep `MobileBoardViewProps` exported.

In `src/components/Board.tsx`, change the import from:

```ts
import { MobileBoardView } from '@/components/MobileBoard';
```

to:

```ts
import MobileBoardView from '@/components/MobileBoard';
```

- [ ] **Step 4: Run typecheck + tests + lint**

```
npm test
npx tsc --noEmit
npm run lint
```

Expected: clean.

- [ ] **Step 5: Commit**

```
git add src/components/Seat.tsx src/components/MobileBoard.tsx src/components/Board.tsx
git commit -m "Drop PlayerState wrappers from Seat and MobileBoard"
```

- [ ] **Step 6: Final gate — all green**

Run every check sequence from the top:

```
npm test
npx tsc --noEmit
npm run lint
cd server && npm test && npx tsc --noEmit
```

All suites green. Server typecheck clean. Root typecheck clean except the pre-existing follow-up #13 `@engine/*`-inside-`server/` noise.

Section 6 complete. Status pointers in `CLAUDE.md` should be updated by a follow-up commit (not in this plan — handled as part of the branch's handoff work).

---

## Appendix: How to run the agent dispatch

If you are an orchestrator dispatching subagents, follow this exactly:

1. **Task 0.1** — single agent, serial. Wait for its commit.
2. **Phase 1** — dispatch five fresh subagents in parallel, one each for Tasks 1.1, 1.2, 1.3, 1.4, 1.5. Each gets the plan and is told "Execute Task X.Y only." Wait for all five commits before moving on.
3. **Task 2.1** — single agent, serial. Runs only after all of Phase 1 has landed. Wait for commit.
4. **Phase 3** — dispatch three fresh subagents in parallel for Tasks 3.1, 3.2, 3.3. Wait for all three commits.
5. **Task 4.1** — single agent, serial. Wait for commit.
6. **Phase 5** — dispatch two fresh subagents in parallel for Tasks 5.1 and 5.2. Wait for both commits.
7. **Task 6.1** — single agent, serial. Wait for commit.

Every subagent must run `npm test` + `npx tsc --noEmit` (root) and, if touching server code, `cd server && npm test && npx tsc --noEmit` before committing. An agent that cannot pass its own tests or typecheck must not commit — it reports the failure back to the orchestrator.

Subagents MUST NOT run `git push` or `git rebase`. They commit locally and report the commit SHA.

## Appendix: What is deliberately out of scope

- Real AI bot strategy (Section 5).
- AWS deploy (Section 7).
- Full end-to-end WS-backed frontend tests (Section 8).
- Chat UI wiring (the protocol supports chat; a UI surface is deferred).
- Card-fly animation, highlight-valid-targets UX (deferred polish).
- A top-bar header in /local matching the old page. Board handles the header; if parity is required, re-add after Section 6 behind a feature flag.
