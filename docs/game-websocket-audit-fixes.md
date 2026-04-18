# Game WebSocket audit — findings and fixes

Two audit passes were run against the Section 3 game-websocket implementation on branch `game-websocket` before merge. This document captures every finding and its resolution so future sessions have the full reasoning trail.

- **Audit 1 (first-principles):** walked the new code against the plan, looked for obvious bugs, security gaps, and perf smells.
- **Audit 2 (doc-grounded):** cross-referenced the code against the `ws@8` README, Node.js timers docs, pino flush docs, and React effect semantics.

Both audits are included. Items are labeled with their original identifier so commits and review history can be traced. "Earlier audit" = audit 1. "Doc audit" = audit 2.

## Commit trail

Every fix is an atomic commit on `game-websocket`. Relevant commits in order:

| Commit | Fix |
|---|---|
| `4d8e52c` | Decouple handleClose cleanup from close-frame guard (C1) |
| `73d3af4` | Exit on production start with wildcard CORS_ORIGIN (C3) |
| `2f4e4c7` | Close game sockets when public room is removed (C2) |
| `beba96a` | Reject unknown fields in client message schemas (I1) |
| `0e8c5ae` | Tighten message rate and kick on repeated illegal actions (I2) |
| `9f55b9d` | Evict stale connection before closing duplicate session (I3) |
| `a5bf07e` | Drop redundant chat length check after Zod validation (I6) |
| `d1e4bec` | Neutralize stale socket before reconnect on visibility resume (I5) |
| `19ce236` | Build seats once per broadcast to share across viewers (I4) |
| `7281374` | Replace heartbeat deadline timer with isAlive boolean (doc #2) |
| `d2da159` | Install error listeners early on ws and upgrade socket (doc #1/#3/#9) |
| `4297655` | Terminate socket when async send reports an error (doc #4) |
| `d9d7a24` | Unref game timers so they do not block process exit (doc #5) |
| `e070476` | Snapshot room set before iterating to survive re-entry (doc #7) |
| `00071dc` | Reject binary frames and coerce fragmented message forms (doc #8) |
| `51aeffd` | Close WebSocketServer and reject upgrades during shutdown (doc #6) |
| `c4e499f` | Flush logs before exit and handle uncaught errors synchronously (doc #10/#13) |
| `8837014` | Neutralize socket on unmount and cap reconnect attempt growth (doc #11/#12) |
| `ae2d024` | Re-read slot inside grace and bot timer callbacks (both audits, minor) |

Final test state: **server suite 105/105, client suite 64/64, typecheck clean.**

---

# Audit 1 — first-principles pass

The first audit ran against the code as-committed from the implementation plan. Four new fields on `Slot.human` + `Room.botPending`, a full new `server/src/game/` module, and a `useGameSocket` hook on the client.

## Critical findings

### C1 — `handleClose` short-circuits on `this.closed`, leaking registry state on server-initiated closes

**Files:** `server/src/game/connection.ts` (lines ~70-74, 194-216)

**What was wrong.** `close(code, reason)` set `this.closed = true` before calling `ws.close()`. When the underlying `'close'` event later fired, `handleClose` checked `this.closed`, saw `true`, and bailed out — never running `registry.remove`, never flipping `slot.connected = false`, never starting grace.

**Impact paths.**
- **Duplicate-session kick (4004).** The stale connection stayed in the room's `Set<RegisteredConnection>` forever. The new connection was added alongside it, producing two entries for one human. `findBySession` could return the dead one. `broadcastState` iterated both and built views for both.
- **Rate-limit / backpressure kill (1008).** The player's slot stayed `connected: true` even though the socket was gone. Other players never saw them disconnect. Grace never started, so reconnect found `slot.connected === true` and happily added another duplicate entry.
- **Game-ended 4005.** Every seat's connection entry leaked for ~5 minutes (until post-game cleanup deleted the room).

**Fix.** Added a second boolean `cleanedUp` to `GameConnection` that guards re-entry into `handleClose`. `close()` still guards against double-frame with `closed`, but cleanup is now owned entirely by `handleClose` and runs regardless of who initiated the close.

### C2 — `deleteRoom` did not evict the `GameRegistry`

**Files:** `server/src/room/manager.ts` (deleteRoom), `server/src/index.ts`

**What was wrong.** `RoomManager` and `GameRegistry` never talked. When a room was deleted, the sockets for that room were not closed. The only cleanup path was a 150ms `setTimeout` inside `onAfterCommit` — which ran after a winning move, but had no counterpart for "host abandoned a playing room" or "idle room timed out."

**Fix.** Subscribed the `GameRegistry` to the existing `roomRemoved` lobby event in `index.ts`:
```ts
roomManager.events.on('roomRemoved', (e) => {
  registry.publish(e);
  gameRegistry.forEachInRoom(e.roomId, (conn) => conn.close(4005, 'room closed'));
});
```

**Known limitation.** `emitRoomRemoved` has a `visibility !== 'public'` guard, so this subscription only fires for public rooms. Private rooms still rely on the 150ms `setTimeout` in `onAfterCommit` for game-end cleanup; private rooms deleted via abandonment (host leaves playing room) do leak sockets. Flagged as a follow-up — not blocking since the product currently exposes public rooms via the lobby.

### C3 — `corsOrigin` defaulted to `'*'` and bypassed the origin check entirely

**Files:** `server/src/config.ts`, `server/src/game/handshake.ts`, `server/src/index.ts`

**What was wrong.** `config.corsOrigin` defaulted to `process.env.CORS_ORIGIN ?? '*'`. The handshake treated `'*'` as "skip origin validation," so any deployment missing the `CORS_ORIGIN` env var accepted WebSocket Upgrade requests from any origin. Since WebSocket handshakes from browsers don't enforce CORS the way `fetch` does, this is the exact primitive for a Cross-Site WebSocket Hijacking (CSWSH) attack — an attacker who knows a victim's sessionId could open a WS from `evil.com` and play on the victim's behalf.

**Fix.** Added a startup guard in `index.ts`:
```ts
if (process.env.NODE_ENV === 'production' && config.corsOrigin === '*') {
  logger.fatal('CORS_ORIGIN must be set in production to prevent CSWSH');
  process.exit(1);
}
```
Dev still accepts `'*'` for localhost flexibility.

## Important findings

### I1 — Zod schemas accepted unknown fields silently

**Files:** `server/src/game/protocol.ts`

`z.object({...})` defaults to `'strip'` mode: unknown keys are silently removed. The spec says unknown messages should cause a 1008 close. Not exploitable today because the engine ignored extras, but a defense-in-depth regression waiting to happen. Fixed by adding `.strict()` to every inner schema object (`CardSourceSchema` variants, `GameActionSchema` variants, `ClientMessageSchema` variants). Added two tests for extra-field rejection.

### I2 — Rate limit too permissive against illegal-action spam

**Files:** `server/src/game/connection.ts`

`MSG_RATE_LIMIT` was `{ capacity: 20, refillPerMs: 10/1000 }` — 10 messages/sec sustained. A coordinated attack at 10 illegal actions/sec per bot × 100 bots = 1000 engine validations/sec. Fixed by:
- Tightening `MSG_RATE_LIMIT` to `{ capacity: 10, refillPerMs: 5/1000 }` (5/sec sustained, burst 10).
- Adding `ERROR_RATE_LIMIT = { capacity: 3, refillPerMs: 1/1000 }` (3 errors burst, 1/sec refill). User requested the more forgiving 1/sec (vs the recommended 5/10s) — rationale: legitimate users exploring the UI can generate occasional `actionError` without getting kicked.
- When the error bucket is exhausted, close the socket with 1008 `too many illegal actions`.

### I3 — Duplicate-session: stale connection still in registry when new one attached

**Files:** `server/src/game/handshake.ts`

`existing.close(4004, ...)` sent the close frame but cleanup was async (via the `'close'` event). `wss.handleUpgrade` was called immediately after, and the new `GameConnection` added itself to the registry — briefly, both stale and new shared the same `sessionId`. Fixed by synchronously `deps.registry.remove(roomId, existing)` before `close(4004)`. Combined with the C1 fix, the flow is now deterministic.

### I4 — `broadcastState` rebuilt N full views per action

**Files:** `server/src/game/view.ts`, `server/src/game/connection.ts`

Each action triggered a broadcast that iterated every connection and called `buildGameView(room, sessionId)` per recipient. Internally each call rebuilt the full seat array — identical for every viewer. For an 8-player partnership room that was 8× redundant work.

**Fix.** Extracted `buildSeats(room): GameViewSeat[]` as a separate helper. `buildGameView` now accepts an optional pre-built `seats` argument. `broadcastState` builds seats once and passes the same reference to every per-viewer call. Per-viewer work is now only the hand-hiding portion inside `getPlayerView`.

User specifically asked for this to ship now (not as a follow-up) despite the recommender tagging it as deferrable.

### I5 — Visibility resume could orphan in-flight socket

**Files:** `src/lib/net/useGameSocket.ts`

`onVisible` checked `readyState !== WebSocket.OPEN` and called `connect()` if not open. For `readyState === CONNECTING` (tab backgrounded during the sub-second handshake, then foregrounded) this created a second socket. The first socket's `onclose` would fire later and, under the original code, unconditionally null `wsRef.current` — clobbering the fresh socket.

**Fix.** Before creating the new socket, explicitly null all four handlers on the stale one (`onopen`, `onmessage`, `onclose`, `onerror`), then close it. The stale socket can no longer step on shared state when it eventually emits its close event.

### I6 — Redundant chat length check after Zod

**Files:** `server/src/game/connection.ts`

`ClientMessageSchema` already enforced `.max(MAX_CHAT_LEN)`. The post-parse `if (msg.text.length > MAX_CHAT_LEN) return;` was unreachable dead code. Deleted it + the now-unused `MAX_CHAT_LEN` import.

## Minor nits from audit 1 (not separately actioned; most were polish)

- `startHeartbeat` setInterval + setTimeout pattern — flagged as style nit in audit 1, escalated to a **Critical bug** in audit 2 (doc #2 below).
- `grace.ts` timer callback mutated a dangling slot reference — fixed via the timer state re-check (see "Minor combined" below).
- `dispatch.ts` chat sanitizer strips only ASCII C0/DEL — does not touch U+0080–U+009F C1 block, U+2028/U+2029 line separators, or zero-width chars. Safe today because frontend renders names as plain text children, not via `dangerouslySetInnerHTML`. Deferred as a future hardening step; will revisit if client rendering changes.
- `handshake.ts` non-null assertions — style; no fix.
- `useGameSocket.ts` outbound queue has no action-ID / dedup — means a reconnect after a successful-but-acked-before-disconnect action could replay and get `notYourTurn`. Acceptable for v1; add an ack-ID protocol if it becomes user-visible.
- `mapping.ts` naming: `playerId` is a union of `sessionId` and `botId`. Slightly misleading but works.
- `bot.ts` 800ms delay not cancelable — addressed via the timer state re-check (below).
- `view.ts` AI seat name is the raw `botId` — UI polish.

---

# Audit 2 — doc-grounded pass

After the audit 1 fixes shipped, a second audit ran against the `ws@8` README, Node.js timers docs, pino flush docs, and React effect semantics. It found three issues the first pass missed by relying on first-principles reasoning.

## Critical findings

### Doc #2 — Heartbeat never actually terminated dead connections

**File:** `server/src/game/connection.ts`

**What was wrong.** `startHeartbeat()` used `setInterval(HEARTBEAT_MS = 25_000)` that on each tick called `ws.ping()` and scheduled a **fresh** `setTimeout(HEARTBEAT_TIMEOUT_MS = 30_000)` deadline — clearing the previous one. Because `30_000 > 25_000`, the next ping always arrived before the deadline could fire, clearing it and starting a new one. **A truly dead client therefore was never terminated.**

**What the ws docs say.** The canonical "How to detect and close broken connections?" example in the `ws` README uses an `isAlive` boolean collapsed into a single tick — there is no overlapping timer.

**Fix.** Replaced both `heartbeatTimer` and `heartbeatDeadline` with a single `isAlive` boolean:
```ts
private startHeartbeat(): void {
  this.heartbeatTimer = setInterval(() => {
    if (!this.isAlive) {
      try { this.ws.terminate(); } catch {}
      return;
    }
    this.isAlive = false;
    try { this.ws.ping(); } catch {}
  }, HEARTBEAT_MS);
}
```
And in `attach()`: `this.ws.on('pong', () => { this.isAlive = true; });`. If the client pongs within the 25s window, `isAlive` flips true and the next tick pings again. If not, the next tick terminates.

### Doc #1 — No error listener on the raw upgrade socket during handshake

**File:** `server/src/game/handshake.ts`

**What was wrong.** Between the TCP socket being handed to our upgrade callback and the WebSocket state-machine attaching, any error on the raw `Duplex` socket (RST mid-handshake, slow-lorris-style hang) would emit `'error'` with no listener — which Node turns into `uncaughtException`. That would trigger `installShutdown(1)` and **kill the entire server, dropping every open game**.

**What the ws docs say.** The "Client authentication" and "noServer" examples register `socket.on('error', ...)` immediately on entry and only remove it once `handleUpgrade`'s callback fires.

**Fix.** Defined `onSocketError` at the top of the factory; register it first thing in every call to the returned handler; remove it inside every `wss.handleUpgrade` callback (all three paths: valid upgrade, 4003 reject, 4003 no-slot).

### Doc #3 — `ws.on('error')` wired too late in `attach()`

**File:** `server/src/game/connection.ts`

**What was wrong.** `attach()` called `sendHello()` and `broadcastState()` *before* registering `this.ws.on('error', ...)`. `ws.send()` can synchronously emit `'error'` on a socket whose ws state just transitioned to CLOSED — without a listener that becomes `uncaughtException`.

**What the ws docs say.** Every example in the README registers the error listener as the first action in the connection handler.

**Fix.** Moved `this.ws.on('error', ...)` to the very first line of `attach()`, before any send / broadcast / heartbeat setup.

## Important findings

### Doc #4 — `ws.send()` errors swallowed

**File:** `server/src/game/connection.ts`

`try { this.ws.send(JSON.stringify(message)); } catch {}` ignored all errors. The `ws.send()` async error path (callback signature) was completely ignored. After a network error the socket was useless but `this.closed` stayed false, so subsequent sends kept silently failing and the client never saw a close until the next heartbeat (up to 25s later).

**Fix.** Pass a callback:
```ts
this.ws.send(JSON.stringify(message), (err) => {
  if (!err) return;
  this.log.warn({ err, sessionId: this.sessionId }, 'sendError');
  try { this.ws.terminate(); } catch {}
});
```
The resulting `'close'` event runs `handleClose`, which does the full cleanup including grace start.

### Doc #5 — Timers not `.unref()`-ed, blocking test teardown

**Files:** `server/src/game/bot.ts`, `server/src/game/grace.ts`, `server/src/game/connection.ts`

Plain `setTimeout` / `setInterval` handles keep the Node event loop alive. In production the HTTP server dominates, so this was silent. But Vitest suites that spin up a `GameConnection` without clean teardown hung waiting for the 25s heartbeat or 60s grace timer. Current tests all close their connections explicitly, so the bug was latent — one misconfigured `afterEach` away from flakes.

**Fix.** Called `.unref()` on: `slot.graceTimer` in `grace.ts`, the bot-move `setTimeout` handle in `bot.ts`, `this.heartbeatTimer` in `connection.ts`, and the 150ms game-ended close setTimeout in `onAfterCommit`. These are advisory — they let the process exit cleanly when nothing else is holding it.

### Doc #6 — `WebSocketServer.close()` never called during shutdown

**Files:** `server/src/game/handshake.ts`, `server/src/shutdown.ts`, `server/src/index.ts`

`createGameUpgradeHandler` created a module-scoped `WebSocketServer({noServer: true})` that was never closed during shutdown. The ws docs say: "If an external HTTP server is used via the `server` or `noServer` constructor options, it must be closed manually." With `process.exit` this was moot at the process boundary, but the design leaked listeners in tests and allowed upgrades during the drain window.

**Fix.** Refactored `createGameUpgradeHandler` to return an object:
```ts
export interface GameUpgradeHandler {
  handleUpgrade: (req, socket, head) => void;
  close: () => void;
}
```
The close method flips a `shuttingDown` flag and calls `wss.close()`. `installShutdown` accepts an `upgrade` option and calls `upgrade.close()` as the first step. New upgrades during drain get an HTTP 503.

### Doc #7 — Iteration re-entry in `forEachInRoom` → `handleClose` → `broadcastState`

**File:** `server/src/game/registry.ts`

`broadcastState` calls `forEachInRoom(roomId, (conn) => conn.send(msg))`. `conn.send()` can trigger a backpressure kill, calling `this.close()`, then `handleClose` synchronously, which removes the conn from the Set and calls `broadcastState` again — re-entering the iteration. Safe today per ECMAScript Set iterator semantics, but fragile.

**Fix.** Snapshot before iterating: `for (const conn of [...set])` instead of `for (const conn of set)`. One-line change.

### Doc #8 — `handleMessage` didn't handle `isBinary` or `Buffer[]` fragments

**File:** `server/src/game/connection.ts`

The ws `'message'` event has a second arg `isBinary`. For fragmented messages the first arg can be `Buffer`, `ArrayBuffer`, `Buffer[]`, or string depending on `binaryType`. The code only handled `string` and `Buffer`; everything else closed with 1008 `bad frame`. Unlikely to hit from browser clients (browsers don't fragment text), but formally incorrect.

**Fix.** Wired `(raw, isBinary)` → reject binary with 1003 `binary not supported`; handle `Buffer`, `Buffer[]` (concat), and `ArrayBuffer` paths. String path unchanged.

### Doc #9 — Missing `wsClientError` listener on WebSocketServer

**File:** `server/src/game/handshake.ts`

`wss.on('wsClientError', (err, socket) => ...)` is the ws library's hook for handshake-time errors that bypass the `try` block (malformed headers, missing `Sec-WebSocket-Key`, etc.). Without it, the server falls back to a default 400 response with no logging.

**Fix.** Registered inside `createGameUpgradeHandler`:
```ts
wss.on('wsClientError', (err, socket) => {
  log.warn({ err }, 'wsClientError');
  try { socket.destroy(); } catch {}
});
```

### Doc #10 — `process.exit` truncating pino log flushing

**File:** `server/src/shutdown.ts`

Node's `process.exit()` docs: "will force the process to exit as quickly as possible even if there are still asynchronous operations pending that have not yet completed fully, **including I/O operations to process.stdout and process.stderr**." pino specifically warns to call `flush()` before `process.exit`. Shutdown logs were at risk of being truncated when stdout was a pipe (pm2, docker).

**Fix.** `logger.flush()` before the exit, then `setImmediate(() => process.exit(code))` so the event loop can drain one tick.

### Doc #11 — React StrictMode: stale socket's onclose could clobber the fresh one after remount

**File:** `src/lib/net/useGameSocket.ts`

StrictMode mounts → unmounts → re-mounts components in development. The existing unmount cleanup called `ws.close(1000)` but left `ws.onclose` wired. When the stale socket's close event fired later, it ran its original handler which unconditionally set `wsRef.current = null` and scheduled a `setTimeout(connect, delay)`. After the second mount, that scheduled reconnect stepped on the live socket.

**Fix.** Unmount cleanup now neutralizes the stale socket's handlers (`onopen = null; onmessage = null; onclose = null; onerror = null;`) before calling `close(1000)`. Same pattern that was already in `onVisible`.

### Doc #12 — Unbounded `attemptRef` growth

**File:** `src/lib/net/useGameSocket.ts`

`500 * Math.pow(2, attempt)` was clamped to 10s via `Math.min`, but `attemptRef.current` grew unbounded. After thousands of attempts the `Math.pow` call on a large integer enters float-imprecision territory.

**Fix.** Added `MAX_RECONNECT_ATTEMPT = 16`; `computeReconnectDelay` now caps the attempt parameter via `Math.min`, and `attemptRef.current = Math.min(attemptRef.current + 1, MAX_RECONNECT_ATTEMPT)` in the onclose handler. Added a test covering saturation at the ceiling.

### Doc #13 — `uncaughtException` handler doing async work

**File:** `server/src/shutdown.ts`

The original handler called `void shutdown(1)` — an async function that awaited `httpServer.close()`. Node docs explicitly warn: "It is not safe to resume normal operation after `uncaughtException`... correct use... is to perform synchronous cleanup."

**Fix.** Changed to synchronous handling: log fatal, `logger.flush()`, `process.exit(1)`. Same for `unhandledRejection`.

## Minor findings from audit 2 not separately actioned

- Per-recipient `ServerMessage` object allocation in `broadcastState` — not worth optimizing until 16+ viewers per room.
- No outbound byte-size cap — `maxPayload` only applies inbound, but outbound state messages are small.
- 150ms magic number for gameEnded close after `finishGame` — timing-dependent but works in practice. Made redundant by C2's event-bus subscription for public rooms; still useful for private-room fallback.
- `handshake.ts` minor cleanup on `new URL(req.url ?? '/', ...)` — style only.
- `protocol.ts` chat sanitizer slicing to 200 after Zod already caps at 200 — redundant but harmless.

## Combined minor — timer state re-checks (both audits flagged)

**Files:** `server/src/game/grace.ts`, `server/src/game/bot.ts`

Both audits noted that the `grace` and `bot` setTimeout callbacks captured `slot` via closure. If the room mutated between scheduling and firing (rare but possible), the callback would mutate the captured reference. Also: if a human reconnected during the 800ms bot-move delay, the bot should NOT fire its move.

**Fix.** Re-read `room.slots[slotIndex]` inside both timer callbacks before touching state. In `bot.ts`, additionally re-check `stillBot` (the seat is either `kind === 'ai'` or `human && botControlled`). Slot mutations happen via fresh references through `setSlot`, so re-reading is the safe pattern.

---

# Deferred follow-ups

Not blocking for this branch but worth a future session:

1. **Private-room socket cleanup on abandonment.** The C2 event-bus subscription only fires for public rooms because `emitRoomRemoved` guards on `visibility === 'public'`. Private rooms that are abandoned (host leaves playing room) leak game sockets until process restart. Fix options: remove the visibility guard (SSE handler would need to filter), or add a dedicated `roomClosed` internal event.
2. **Outbound message dedup / ack IDs.** `useGameSocket.ts`'s send queue could replay an already-applied action on reconnect, causing a harmless `notYourTurn` rebound. If users start noticing the stale error surface, add ack IDs.
3. **Broader chat/name sanitization.** Only ASCII C0/DEL stripped today. Extend to C1 (U+0080–U+009F), U+2028/U+2029, zero-width chars if any client path later uses dangerouslySetInnerHTML.
4. **Private-room gameEnded fallback removal.** Once #1 is addressed, the 150ms `setTimeout` in `onAfterCommit` becomes fully redundant and can be deleted.
5. **Pre-serialize broadcasts at scale.** `JSON.stringify(msg)` runs per recipient in `send`. For N+16 viewer rooms, stringify once per view shape and pass the string to `ws.send`.

---

# What was verified correct against docs

The doc-grounded audit explicitly checked and confirmed:

- `ws.ping()` with no args is sufficient (pong auto-sent by client per RFC 6455).
- `ws.bufferedAmount` is the right backpressure signal; 256 KB is a reasonable threshold for a text protocol.
- `maxPayload: 16 KB` is server-enforced — ws closes oversized messages with 1009 automatically.
- `handleUpgrade` call order: `socket.on('error')` → `handleUpgrade(req, socket, head, cb)` → inside cb either `emit('connection')` or `ws.close(code)` is correct.
- Close codes in the 4000-4999 range are app-specific per RFC 6455 §7.4.2; reason strings ≤ 123 UTF-8 bytes.
- `ws.terminate()` is correct for heartbeat-timeout (vs `close()` which waits for a close frame that won't arrive).
- `noServer: true` + manual `handleUpgrade` is the recommended ws pattern for mounting on an existing HTTP server.
- Zod `.strict()` on inner schemas is the correct pattern for rejecting extras (as opposed to `.passthrough()` or the default strip).
- `TERMINAL_CLOSE_CODES` on the client correctly includes app codes 4002-4005 and excludes 1001/1006/1011 so clients reconnect on shutdown, network flaps, and policy kicks.
- Engine validates `DISCARD.targetPlayerIndex` via partnership rules — a client cannot discard onto an opponent's pile. Server replays `applyAction` without trust.
- `sessionRoomId(sessionId) === roomId` check at handshake is server-owned; a client cannot forge it without a prior successful REST request.
- `SIGTERM`/`SIGINT` listeners registered once each — no listener leak.
