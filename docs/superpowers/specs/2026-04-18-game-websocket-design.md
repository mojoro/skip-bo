# Game WebSocket — Design

**Date:** 2026-04-18
**Status:** Approved (pending user review of this document)
**Scope:** Section 3 of the Skip-Bo networking design. Picks up after Sections 1 (engine, implemented), 2 (initial WS protocol, rewritten here), and 4 (Room Manager + Lobby, implemented as `server/`).

## Context

Skip-Bo is a browser-based multiplayer card game built as part of John Moorman's "10 projects in 10 weeks" sprint. Primary learning goals: real-time WebSocket plumbing, AWS deployment, state management written from scratch. No Colyseus, no PartyKit, no Socket.IO.

Sections 1 and 4 are in the repo. The engine lives at `src/lib/game/`; the server at `server/`. Section 4 ships REST + SSE lobby with in-memory `RoomManager`, with integration stubs reserved for the game WS (`shutdown.ts` line 20, `manager.ts:removeMember` lines 149–154). This document specifies the WS layer that fills those stubs and carries every in-game action.

## Decisions locked during brainstorming

| # | Question | Answer |
|---|----------|--------|
| 1a | During the 60 s grace window, whose turn runs? | Game sits on the disconnected player's turn; other players continue normally on their own turns. |
| 1b | After grace expires | Slot stays `kind: 'human'`, `connected: false`, `botControlled: true`. Bot plays their turn. Reconnect at any time (even hours later) hands control back to the human. |
| 2 | Broadcast shape | Per-socket `GameView` (engine `PlayerView` + server-owned seat presence) after every action. Server filters for each connected seat. |
| 3 | Chat | In v1. Rate-limited, max 200 chars, sanitized on render. |
| 4 | WS endpoint | `wss://host/rooms/:roomId/game?sessionId=…`. Path-encoded room. |
| 5 | Action validation | Cheap pre-check (turn owner, connected, phase) then engine replay. |
| 6 | Test strategy | Hybrid: unit tests for pure dispatch + real-socket integration tests for handshake + happy flow + close codes. |
| 7 | Initial sync | Server pushes `hello` with `{stateVersion, view: GameView}` on open. Same shape for first join and reconnect. |
| 8 | Presence signals | `GameView.seats[i]` carries `connected`, `graceDeadline`, and `botControlled`. One message type (`state`); client reconciles from snapshots. |

## 3.1 — Architecture overview

The game server gains a third surface alongside REST and SSE lobby:

- **REST** (Section 4) — imperative lobby actions.
- **SSE** (Section 4) — public lobby feed.
- **WebSocket** (this section) — one persistent connection per player per game. Carries actions and chat, broadcasts state.

All three share one `http.Server`. The WS layer registers an `upgrade` handler that path-matches `/rooms/:roomId/game`; other paths fall through to the REST router.

```
Browser                              EC2 / Node (single process)
────────                             ──────────────────────────────────────
page.tsx  ──useGameSocket──►  WSS /rooms/:roomId/game?sessionId=…
                                     │
                                     ▼
                              Upgrade handler
                              (origin, session lookup, dup check)
                                     │
                                     ▼
                              GameConnection
                              ├─ owns: WebSocket, sessionId, roomId, slotIndex
                              ├─ reads: RoomManager.get(roomId)
                              └─ calls: applyAction, registry.broadcast
                                     │
                                     ▼
                              GameRegistry          RoomManager.events
                              Map<roomId,           (lobby SSE already subscribes;
                                  Set<GameConn>>     game WS does not re-emit)
```

Files land under `server/src/game/`:

- `handshake.ts` — HTTP Upgrade handler: origin check, session/room validation, duplicate-socket kick, promote.
- `connection.ts` — per-socket lifecycle: attach, heartbeat, message loop, close.
- `registry.ts` — `Map<roomId, Set<GameConnection>>`. Broadcast helper, fanout, iteration for shutdown.
- `protocol.ts` — Zod schemas for `ClientMessage` + TS types for `ServerMessage`.
- `dispatch.ts` — pure message-routing: given `(room, sessionId, msg, clock)`, returns a side-effect list.
- `grace.ts` — per-slot 60 s timer management. Start, cancel, fire.
- `bot.ts` — post-grace and AI-seat turn driver. Section 5 integration point; v1 plays a legal random move.

`server/src/index.ts` gains one more wiring step: construct `GameRegistry`, mount the Upgrade handler, pass `gameRegistry` to `installShutdown`.

**Single-process scope.** Matches Section 4 — no cross-node sync, no Redis. Scale-out remains an interview talking point, not code we ship.

## 3.2 — Wire protocol

JSON, UTF-8. `maxPayload: 16 * 1024`. Every message has a `type` discriminator. Zod validates client messages; unknown or malformed messages close with **1008**.

### Client → Server

```typescript
type ClientMessage =
  | { type: 'action'; action: GameAction }
  | { type: 'chat'; text: string }     // max 200 chars, rate-limit 5 msgs / 10 s
```

No explicit `hello` or `ping` from the client. Server pushes the snapshot on open. Heartbeat is protocol-level `ws.ping()`, not an app-level JSON message.

### Server → Client

```typescript
type ServerMessage =
  | { type: 'hello';       stateVersion: number; view: GameView }
  | { type: 'state';       stateVersion: number; view: GameView }
  | { type: 'actionError'; reason: string; stateVersion: number }
  | { type: 'chat';        fromSlotIndex: number; fromName: string; text: string; sentAt: number }
  | { type: 'gameEnded';   stateVersion: number; view: GameView; reason: 'winner' | 'abandoned' }
```

`hello` and `state` share their shape; only the `type` differs. `hello` lets the client hook reset local state cleanly on first message. `gameEnded` is followed by the server closing each socket with **4005** after a short flush delay.

### `GameView`: server-owned wrapper

The engine's `PlayerView` (`src/lib/game/engine.ts` line 398) stays untouched — it has `config`, `phase`, `turnPhase`, `currentPlayerIndex`, `stateVersion`, `buildPiles`, `drawPileCount`, `youIndex`, `you`, `opponents`. It knows nothing about sockets, rooms, or presence. The server wraps it in a `GameView` that adds per-slot presence drawn from `Room.slots`:

```typescript
interface GameView {
  view: PlayerView                   // unchanged engine projection for the target player
  seats: GameViewSeat[]              // length === Room.slots.length, indexed by slotIndex
}

interface GameViewSeat {
  slotIndex: number
  kind: 'human' | 'ai' | 'locked' | 'open'
  name: string | null                // human's name or AI botId; null for open/locked
  connected: boolean                 // humans only — always true for AI, false for open/locked
  graceDeadline: number | null       // epoch ms; non-null only while a human is in grace
  botControlled: boolean             // true once grace expires and bot plays for this human
}
```

`RoomManager` owns `slots[i].connected` / `graceDeadline` / `botControlled`. `buildGameView(room, sessionId)` on the server calls the pure engine `getPlayerView(room.game, playerId)` and stamps the presence seats alongside. Client receives one payload with everything it needs; engine remains pure.

Mapping `sessionId` → engine `playerId`: `Room.slots[slotIndex]` has `sessionId`; `Room.game.players[playerIndex]` has `id` derived from `sessionId` at `initializeGameState` time (server/src/room/lifecycle.ts). `buildGameView` resolves through the slot → player mapping.

### Close codes

| Code | Meaning | Who sends |
|------|---------|-----------|
| 1000 | Normal | Client on unload. Server never sends 1000 as a primary close reason. |
| 1001 | Going away | Server on SIGTERM / graceful shutdown. |
| 1008 | Policy violation | Server on malformed JSON, Zod failure, rate-limit overrun, backpressure kill. |
| 1009 | Message too big | Server via `maxPayload` enforcement. |
| 4002 | Kicked | Server when host kicks via slot PUT (REST). |
| 4003 | Invalid session | Server at handshake when `sessionRoomId(sessionId) !== roomId` or `room.phase !== 'playing'`. |
| 4004 | Duplicate session | Server when a 2nd socket opens for the same sessionId; the older socket is closed with 4004. |
| 4005 | Game ended | Server fanout after `gameEnded` broadcast. |

4001 (room full) is reserved but unused — Section 4's slot mutation prevents ever reaching the WS layer with no seat.

## 3.3 — Handshake + connection lifecycle

### Upgrade handler (`handshake.ts`)

On `httpServer.on('upgrade', (req, socket, head) => …)`:

1. **Path match.** `new URL(req.url, \`http://${req.headers.host}\`).pathname` matches `^/rooms/([^/]+)/game$`. Mismatch → `socket.destroy()`.
2. **Origin check.** `req.headers.origin` must be in `config.corsOrigin`. Mismatch → write `HTTP/1.1 403 Forbidden\r\n\r\n` and `socket.destroy()` (no WS handshake).
3. **Query parse.** Extract `sessionId`. Missing or malformed → `400 Bad Request`.
4. **Session / room validation.** `roomManager.sessionRoomId(sessionId) === roomId` AND `room.phase === 'playing'`. Mismatch → complete WS handshake then `ws.close(4003, 'invalid session')`. Using the close-code path keeps client-side rejection handling uniform.
5. **Slot lookup.** `slotIndex = room.slots.findIndex(s => s.kind === 'human' && s.sessionId === sessionId)`. If < 0 → close 4003 (invariant: an active `sessionRoomId` mapping without a matching slot is a bug, but defend against it).
6. **Duplicate kick.** If `gameRegistry` already has a connection for this `(roomId, sessionId)`, close the old socket with 4004 before promoting the new one.
7. **Promote.** `wss.handleUpgrade(req, socket, head, ws => new GameConnection(ws, room, sessionId, slotIndex))`.

### Connection (`connection.ts`)

On attach:

- Flip `room.slots[slotIndex].connected = true`.
- If `slot.graceTimer` exists (returner within grace), cancel the timer; null `graceDeadline`.
- If `slot.botControlled` is true (returner after grace), set `botControlled = false`.
- Register in `gameRegistry`.
- Send `{ type: 'hello', stateVersion, view: buildGameView(room, sessionId) }`.
- Fan out `state` to everyone else in the room so they see the connected flip.
- Start heartbeat: `ws.ping()` every **25 s**. On `pong`, mark last-seen. If no pong for 30 s, `ws.terminate()`.

On `message`:

- **Rate limit.** Token bucket, 10 msgs/sec sustained, burst 20. Overrun → `close(1008, 'rate limit')`.
- **Size guard.** Enforced by `maxPayload`; oversize → auto `close(1009)`.
- **Zod parse.** Fail → `close(1008, 'bad message')`.
- **Dispatch** to `dispatch.ts`:
  - `action` → pre-check (`game.currentPlayerIndex === slotIndex`, `slot.connected`, `room.phase === 'playing'`) → `applyAction(room.game, action)`. On ok, commit `room.game = next.state`, broadcast `state`, then call `maybeRunBotTurn(room)`. On fail, reply `actionError` to sender only (include current `stateVersion` so the client can reconcile).
  - `chat` → per-sender rate limit (5 / 10 s), truncate to 200 chars, strip control chars (`\x00-\x1f\x7f`), broadcast `chat` to every connected socket in the room.

On `close`:

- Flip `slot.connected = false`.
- If `room.phase === 'playing'`, call `grace.start(room, slotIndex)` (3.4).
- Otherwise (phase changed, shutdown, kick): no-op beyond removing from registry.
- Broadcast updated `state` so other clients see the connected/graceDeadline change.
- Remove from `gameRegistry`.

### Backpressure

Before every `ws.send`, check `ws.bufferedAmount < 256 * 1024`. If over, `ws.close(1008, 'slow consumer')` and log. Prevents a stuck client from holding server memory.

## 3.4 — Grace + bot takeover

Grace is **per slot**, not per room. Other seats continue acting on their own turns; the game only effectively sits when it becomes the disconnected player's turn.

### Slot extension + room field

```typescript
// server/src/types.ts — extend the human variant
type Slot =
  | { kind: 'open' }
  | { kind: 'locked' }
  | { kind: 'ai'; botId: string; difficulty: 'easy' }
  | { kind: 'human'; sessionId: string; name: string; connected: boolean; joinedAt: number;
      graceDeadline: number | null;
      graceTimer: NodeJS.Timeout | null;
      botControlled: boolean;
    }

// additive field on Room
interface Room {
  // ...existing fields...
  botPending: Set<number>           // slotIndex set; prevents double-scheduling in maybeRunBotTurn
}
```

### Rules

- **Start.** Close of a `connected: true` human slot during `phase === 'playing'` sets `connected: false`, `graceDeadline = Date.now() + 60_000`, arms a 60 s `setTimeout`.
- **Grace visible, game not paused.** Other players play their turns normally. When it becomes this seat's turn and they're still disconnected within grace, the game sits — no action arrives, no `actionError` is generated, `maybeRunBotTurn` does not run for this seat yet.
- **Timer fires** (still disconnected): `graceDeadline = null`, `botControlled = true`, `graceTimer = null`. Broadcast `state`. If it's currently their turn, `maybeRunBotTurn` schedules a bot move.
- **Reconnect at any point** (within or past grace): cancel `graceTimer` if present, clear `graceDeadline`, flip `botControlled = false`, set `connected = true`. Broadcast `state`. Human resumes.
- **Multiple concurrent disconnects** each run their own per-slot timer. No global state.
- **Phase-changed cleanup.** On `finishGame` or room deletion, every slot's `graceTimer` must be cleared (3.6 shutdown step 6 handles the process-exit case).

### `maybeRunBotTurn(room)`

Called after every successful `applyAction` broadcast, after a grace-timer fire, after every reconnect (no-op if current seat is a connected human).

```
if room.phase !== 'playing' → return
const seat = room.slots[room.game.currentPlayerIndex]
if seat.kind === 'ai' → schedule bot move in 800 ms
if seat.kind === 'human' && seat.botControlled → schedule bot move in 800 ms
otherwise → return
```

800 ms is a UX placeholder. Section 5 replaces the "legal random move" stub with strategy. `maybeRunBotTurn` is idempotent — if it's already pending for a given seat, a second call is a no-op (tracked via `room.botPending: Set<number>`).

### Relationship to Section 4

Section 4's spec (lines 303–306) described a stub behavior where a grace-expired slot either swapped to `{kind: 'ai'}` or ended the game based on `allowAiFill`. This spec supersedes that recap: the slot stays `kind: 'human'` with `botControlled: true`, always — `allowAiFill` governs only pre-start AI fill, not mid-game grace. `manager.ts:removeMember` lines 149–154 (the "stub by finishing immediately" branch for host-leave during `playing`) is also superseded: host-leave during `playing` triggers normal grace on that slot; if they never reconnect and no humans remain, host migration + abandonment rules from Section 4 take over after grace.

## 3.5 — Client hook

### File layout

- `src/lib/net/useGameSocket.ts` — the hook.
- `src/lib/net/protocol.ts` — shared `ClientMessage` / `ServerMessage` / `GameView` types (mirror of `server/src/game/protocol.ts`).
- `src/app/rooms/[roomId]/page.tsx` — network-mode game board, uses the hook.
- `src/app/local/page.tsx` — existing hot-seat demo moved here, unchanged, local `useState` dispatch preserved for offline development and regression reference.

### Shape

```typescript
interface GameSocket {
  view: GameView | null                   // engine PlayerView + presence seats
  stateVersion: number
  status: 'connecting' | 'open' | 'reconnecting' | 'closed'
  lastError: { code: number; reason: string } | null
  sendAction: (action: GameAction) => void
  sendChat: (text: string) => void
  chat: ChatEntry[]                       // capped ring, ~50 entries
}

function useGameSocket(roomId: string, sessionId: string): GameSocket
```

### Internals

- **sessionId source.** `localStorage.skipboSessionId`, generated with `crypto.randomUUID()` on first visit. Same key Section 4's lobby flow uses.
- **Connection URL.** `${process.env.NEXT_PUBLIC_GAME_WS_URL ?? 'wss://' + host}/rooms/${roomId}/game?sessionId=${sessionId}`.
- **Inbound.** `onmessage` → JSON.parse → discriminator switch. `hello` / `state` / `gameEnded` replace `view` and `stateVersion`. `actionError` surfaces via a toast callback and rejects the originating `sendAction` promise (tracked by a sender-side counter). `chat` pushes onto the ring.
- **Outbound buffer.** `sendAction` / `sendChat` queue when `readyState !== OPEN`. Queue bounded to 32; overflow logs a warning and drops the oldest. Flushed on open.
- **Reconnect policy.** Exponential backoff with jitter: `sleep = min(10_000, 500 * 2^attempt) * (0.5 + Math.random() / 2)`. Retry on close codes 1001, 1006, 1011. **Do not retry** on 4002 (kicked), 4003 (invalid session), 4004 (duplicate — other tab won), 4005 (game ended). Terminal codes set `status = 'closed'` with `lastError` populated for the UI to render.
- **Visibility API.** `document.visibilitychange → visible`: if `readyState !== OPEN`, trigger immediate reconnect (bypass backoff clock). Keeps the socket alive across tab-switches on mobile.
- **Teardown.** `useEffect` cleanup calls `ws.close(1000)` and clears pending timers.

### Engine type alignment

`GameView` (= engine `PlayerView` + server-owned seats) is what the hook consumes. Where current components (`Seat`, `TableCenter`, `MobileBoard`) assume full `GameState`, those props are narrowed to the subset of `GameView` they actually read. This is a small refactor inside Section 3 scope; the hot-seat route (`/local`) keeps its own wrapper that builds a synthesized `GameView` (synthetic seats with `connected: true`, `graceDeadline: null`, `botControlled: false`) from local `GameState` so it compiles against the same component signatures.

## 3.6 — Tests + shutdown

### Test layout (`server/tests/game/`)

Per Q6 — hybrid.

**Unit tests (no socket, `vi.useFakeTimers()` where relevant):**

- `dispatch.test.ts` — `(room, sessionId, msg)` produces the right side-effect list. Cases: happy action, wrong-turn rejection, regression guard that B can still act while A is mid-grace (no global pause), chat fanout, malformed JSON, unknown `type`, oversize chat.
- `grace.test.ts` — start grace, advance 59 s → still `connected:false`, `graceDeadline` set. Advance to 60 s → `botControlled: true`, `graceDeadline: null`. Reconnect at 30 s clears timer and flips `connected: true`. Reconnect at 90 s (post-grace) flips `botControlled: false`. Two concurrent per-slot timers don't interfere.
- `bot.test.ts` — `maybeRunBotTurn` runs for `ai` seats and `botControlled` human seats, no-ops on connected humans, no-ops when `room.phase !== 'playing'`. Idempotent: calling twice schedules only one pending move.
- `protocol.test.ts` — Zod schemas: reject unknown `type`, oversize `chat`, missing fields, non-object payloads.

**Integration tests (real sockets, `httpServer.listen(0)`):**

- `handshake.test.ts` — valid handshake receives `hello`. Bad origin → TCP destroy. Wrong sessionId → WS opens then closes with 4003. Duplicate session → old socket gets 4004, new socket proceeds.
- `fullFlow.test.ts` — two real WS clients join a 2-player room, host starts via REST, each client sends `action`, receives per-view `state`, sends `chat` back and forth. One disconnects; other client's next `state` contains `graceDeadline`. First reconnects within 30 s; next `state` clears `graceDeadline`. Game plays to completion; both clients receive `gameEnded` then close 4005.

Reuse Section 4's pattern: `beforeEach` spawns a fresh server, `afterEach` tears it down. Export `resetRegistries()` for pure cross-test isolation. Same file closes out CLAUDE.md follow-up #9 for the game layer (rate-limit state crossing tests).

### Shutdown integration

`installShutdown` in `server/src/shutdown.ts` gains `gameRegistry: GameRegistry` in its options. The body supersedes the stub on line 20:

```
1. httpServer.close()                             // stop new HTTP + WS upgrades
2. registry.closeAllSseStreams(...)               // Section 4 SSE — already present
3. gameRegistry.broadcastClose(1001, 'shutdown')  // all game sockets
4. Drain: poll every 200 ms up to 5 s until every ws.bufferedAmount === 0
5. ws.terminate() stragglers
6. For every room: clearTimeout(idleTimer, cleanupTimer, and each slot.graceTimer)
7. process.exit(code)
```

Step 6 matters: an unref'd `setTimeout` inside a `Slot.graceTimer` keeps the event loop alive after `process.exit` is queued. All timers must be explicitly cleared.

### Metrics / logging

Per-connection logger child with `{ roomId, sessionId, slotIndex }`. Log: `attach`, `detach` (with close code + reason), `graceStart`, `graceExpire`, `botTakeover`, `reconnect`, `backpressureKill`, `rateLimit`. `stats.ts` from Section 4 gains one more counter: `gameSocketsOpen` (observable via existing stats log tick).

## Invariants

1. For every `GameConnection` in `gameRegistry`, there is exactly one `Slot.human` with matching `sessionId` and `connected: true` in `roomManager.rooms[roomId]`.
2. `slot.graceTimer !== null ⇒ slot.graceDeadline !== null ⇒ slot.connected === false`.
3. `slot.botControlled === true ⇒ slot.connected === false ∧ slot.graceTimer === null ∧ slot.graceDeadline === null`.
4. At most one pending bot move per `(roomId, slotIndex)` at a time (tracked via `room.botPending`).
5. `room.game.currentPlayerIndex` advances only through `applyAction`. The WS layer never mutates it.
6. Every `state` and `gameEnded` broadcast payload's `stateVersion` equals `room.game.stateVersion`.

## Out of scope / deferred

- **Spectator connections.** Reserved URL path `/rooms/:roomId/game/spectate` not implemented in v1.
- **Action replay log.** No per-action history broadcast or persisted; full snapshot on every action is canonical.
- **Bot strategy.** v1 bot plays a legal random move. Section 5 replaces the logic.
- **Chat moderation.** Server-side filter is limited to length cap + control-char strip. No profanity filtering, no per-user mute list.
- **Reconnect state diffs.** Always a full snapshot via `hello`. State is tiny; optimizing this buys nothing.
- **Game-state persistence.** Still in-memory per Section 4's §4.5.1. Engine purity keeps a future Redis snapshot layer viable.
- **Binary encoding.** JSON only.

## References

- `docs/superpowers/specs/2026-04-17-room-manager-lobby-design.md` — Section 4, shipped.
- `docs/superpowers/plans/2026-04-17-room-manager-lobby.md` — Section 4 plan, for task-granularity style.
- `docs/design-session-progress.md` — brainstorming progress across all sections.
- `server/src/shutdown.ts` — stub this spec supersedes (line 20).
- `server/src/room/manager.ts` — stub this spec supersedes (`removeMember` lines 149–154).
- `src/lib/game/engine.ts` — `applyAction`, `getPlayerView`; this spec leaves both untouched. Server-side `buildGameView` wraps `getPlayerView` without changing its signature.
