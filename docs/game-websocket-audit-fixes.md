# Game WebSocket audit — findings and fixes

Four audit passes were run against the Section 3 game-websocket implementation on branch `game-websocket`. This document captures every finding and its resolution so future sessions have the full reasoning trail.

- **Audit 1 (first-principles):** walked the new code against the plan, looked for obvious bugs, security gaps, and perf smells.
- **Audit 2 (doc-grounded):** cross-referenced the code against the `ws@8` README, Node.js timers docs, pino flush docs, and React effect semantics.
- **Audit 3 (boundary-crossing):** re-walked the same code after audits 1 and 2 shipped, focused on the engine→wire trust boundary, the shutdown ordering, and the Manager↔WS gap that was deferred. Found the two game-breaking leaks the earlier passes missed.
- **Audit 4 (fresh-reviewer pass):** dispatched after audits 1–3 shipped, with full context of prior findings. Verified every audit-1/2/3 claim against the code (all held except C1's scope), pressure-tested the duplicate-session lifecycle, and found a Critical state-corruption bug the regression tests were blind to.

All four audits are included. Items are labeled with their original identifier so commits and review history can be traced. "Earlier audit" = audit 1. "Doc audit" = audit 2. "Third audit" = audit 3. "Fourth audit" = audit 4.

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
| `8c800c1` | Strip engine seed from the broadcast view (third #A1) |
| `bec61e2` | Map opponent and partnership ids onto slot indices on the wire (third #A2) |
| `c8ab203` | Drop viewer sessionId from you.id in the broadcast view (third #A3-pre) |
| `c18ff07` | Regression-test that the broadcast view hides seed and sessionIds (third #A3) |
| `e802fba` | Broadcast 1001 before awaiting http server close on shutdown (third #C) |
| `43fe846` | Open the game socket over wss when the page is served over https (third #D) |
| `b230adf` | Reject removeMember with a phase error during the playing phase (third #E) |
| `948e86f` | Clear every grace timer when finishGame transitions the phase (third #G) |
| `182fdd9` | Free the session index on any setSlot that displaces a seated human (third #H) |
| `c4a9b7a` | Close pre-playing handshakes with non-terminal 4006 so clients retry (third #I) |
| `90fa7e8` | Drop queued messages on unmount so they do not replay across rooms (third #J) |
| `01ef2e5` | Expose lastActionError separately from transport lastError (third #K) |
| `e0c55c3` | Route game socket cleanup through a visibility-agnostic internal event (third #L) |
| `4986ae8` | Rate-limit game upgrade handshakes per remote address (third #M) |
| `7e15298` | Skip send when the game socket is no longer in the open state (third #N) |
| `d04cf6e` | Skip the joining connection when broadcasting state on attach (third #O) |
| `97d1c80` | Treat 1008 policy close as terminal to break reconnect-kick loops (third #T) |
| `0edd9df` | Funnel every upgrade early-exit through a bail helper that removes the listener (third #U) |
| `29859bb` | Parse the upgrade request URL against a fixed base instead of Host (third #V) |
| `96f8615` | Narrow the upgrade socket to net.Socket to reach remoteAddress (follow-up to third #M) |

Audit-4 additions (this pass):

| Commit (planned) | Fix |
|---|---|
| audit-4 #C1 | Gate handleClose slot mutation on sessionId + registry ownership |
| audit-4 #I1 | Raw-TCP Upgrade test asserting 403 on mismatched Origin |
| audit-4 #I2 | Full-flow tests for grace→bot takeover and finishGame→4005 |
| audit-4 #I4 | Remove dead 150 ms setTimeout in onAfterCommit game-end path |
| audit-4 #I5 | onMemberDisplaced internal event + subscriber closes 4002 |
| audit-4 #I6 | Sync sweepSocketsSync sending 1011 before uncaught exit |
| audit-4 #M1 | Explicit callback types in view.ts and mapping.ts for root tsc |
| audit-4 #M3 | Add 1003, 1009 to client TERMINAL_CLOSE_CODES |
| audit-4 #M5 | Snapshot rooms Map entries before iterating in broadcastCloseAll |
| audit-4 #M6 | Ratchet test for mixed [human, locked, human, ai] seat layout |

Final test state after all four audits: **server suite 115/115, client suite 64/64, server typecheck clean.**

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

1. ~~**Private-room socket cleanup on abandonment.**~~ Closed by third-audit #L (`e0c55c3`). `RoomManager` now fires an internal `roomClosed` event on `deleteRoom` and `finishGame`; `GameRegistry` subscribes unconditionally, so sockets close regardless of visibility.
2. **Outbound message dedup / ack IDs.** `useGameSocket.ts`'s send queue could replay an already-applied action on reconnect, causing a harmless `notYourTurn` rebound. If users start noticing the stale error surface, add ack IDs.
3. **Broader chat/name sanitization.** Only ASCII C0/DEL stripped today. Extend to C1 (U+0080–U+009F), U+2028/U+2029, zero-width chars if any client path later uses dangerouslySetInnerHTML.
4. **Private-room gameEnded fallback removal.** Now that #1 is closed, the 150ms `setTimeout` in `onAfterCommit` is redundant and can be deleted. Leaving it in place as belt-and-suspenders — easy follow-up.
5. **Pre-serialize broadcasts at scale.** `JSON.stringify(msg)` runs per recipient in `send`. For N+16 viewer rooms, stringify once per view shape and pass the string to `ws.send`.
6. **sessionId out of the URL query string.** Third-audit #F flagged it; deferred to the Section 7 AWS deploy since the proper fix (cookie or `Sec-WebSocket-Protocol` subprotocol) needs nginx config changes anyway. Not urgent now that findings A1/A2/A3 stopped the server from broadcasting sessionIds in the first place.

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
- `TERMINAL_CLOSE_CODES` on the client correctly includes app codes 4002-4005 and excludes 1001/1006/1011 so clients reconnect on shutdown, network flaps, and policy kicks. (Third audit amended: 1008 added to terminal, 4006 confirmed non-terminal.)
- Engine validates `DISCARD.targetPlayerIndex` via partnership rules — a client cannot discard onto an opponent's pile. Server replays `applyAction` without trust.
- `sessionRoomId(sessionId) === roomId` check at handshake is server-owned; a client cannot forge it without a prior successful REST request.
- `SIGTERM`/`SIGINT` listeners registered once each — no listener leak.

---

# Audit 3 — boundary-crossing pass

After audits 1 and 2 shipped, a third review ran that widened the scope to
the engine→wire boundary (what `getPlayerView` hands the server, and what the
server hands the client), the shutdown ordering under live traffic, and the
Manager↔WS coupling gaps that the first two passes had explicitly deferred.
Three blind spots emerged:

1. **Naming-as-trust.** `PlayerView` sounds like a public projection, so the
   first two audits trusted it without reading what it actually returned. It
   returned the shuffle seed and raw sessionIds.
2. **Ordering-in-tests.** The full-flow test closed its clients before tearing
   down the HTTP server, masking a real shutdown deadlock for anyone running
   against live traffic.
3. **Scope-drifted deferrals.** A handful of "not urgent" items from the first
   two passes compounded: blocked shutdowns, kick-loops, and a `removeMember`
   path that silently stalled a running game after my own Section 4 REST
   surface was added.

## Critical findings

### #A1 — Shuffle seed leaked in every broadcast

**File:** `src/lib/game/engine.ts:427` (`getPlayerView` returns `config: state.config`)

**What was wrong.** `createGame` stores the mulberry32 seed on `GameState.config.seed`. `getPlayerView` returns the full config, and `buildGameView` (server) forwarded it unchanged into `hello` / `state` / `gameEnded` messages. `createShuffledDeck`, `mulberry32`, and the whole engine module are public on the client side. With seed + stateVersion, any connected client reproduces:

- The initial shuffled deck
- Every opponent's starting hand + stock (the private-by-design slices)
- The full draw-pile order and every future draw
- Every future shuffle of completed build piles

Verified with a 10-line POC during the audit — the seed printed straight out of `getPlayerView('alice')`.

**Fix.** Introduced a wire type `PublicGameConfig` (server/src/game/view.ts) that is `Omit<GameConfig, 'seed'>` plus a sanitized partnership. `buildGameView` destructures `seed` off before constructing the outbound view. Client protocol type mirrors. Commit `8c800c1`.

### #A2 — Opponent ids on the wire were raw sessionIds

**File:** `src/lib/game/engine.ts:418-420` (`OpponentView.id`), via `initializeGameState` using `slot.sessionId` as the engine player id.

**What was wrong.** For human players the engine id equals the sessionId. `getPlayerView` exposed `opponents[].id`, and `config.partnership.teams` stored the same ids. Alice reads `opponents[0].id` from devtools, opens a fresh tab with `?sessionId=<bob-id>`, and the handshake lets her in — the registry even kicks Bob's live connection with 4004 to make room. Seat takeover in two steps.

**Fix.** `PublicPlayerView` uses slot indices on the wire: `OpponentView.slotIndex` replaces `id`; `currentPlayerSlotIndex` and `youSlotIndex` replace the engine-player-indexed equivalents; `PublicPartnershipRules.teams: number[][]` replaces the sessionId-string teams. `buildGameView` maps via `slotIndexForPlayerId`. Commit `bec61e2`.

### #A3 — Viewer's own sessionId still leaked through `you.id`

**File:** `server/src/game/view.ts` (post-A2)

**What was wrong.** After A2, opponent ids were clean, but `view.you.id` still carried the viewer's sessionId. Technically not an attacker primitive (the viewer already knows their own session), but server-side logs or accidental forwarding paths could pick up what should stay strictly client-held.

**Fix.** `PublicPlayerState = Omit<PlayerState, 'id'>`; `buildGameView` destructures `id` off `raw.you` before attaching it. Commit `c8ab203`. Regression test `c18ff07` asserts `JSON.stringify(view)` contains neither the seed nor any raw sessionId, and that partnership teams are slot indices.

### #C — `httpServer.close()` hung on active WebSocket clients during shutdown

**File:** `server/src/shutdown.ts`

**What was wrong.** Original order: `upgrade.close()` → `await httpServer.close()` → `gameRegistry.broadcastCloseAll(1001)`. Node's `http.Server.close()` does not destroy sockets upgraded to WebSocket (documented in nodejs/node#53536), and `wss.close()` in `noServer: true` mode doesn't force-close existing connections either. Result: with any live client, the `await` never resolved and the 1001 broadcast never fired. The full-flow test didn't catch this because it explicitly closed every client before teardown.

**Fix.** Reordered: tell clients to close first, drain briefly, then `httpServer.close()` completes once its remaining (now-closed) sockets drain. Added `installShutdown({onExit})` option so a new test (`server/tests/shutdown.test.ts`) could exercise the flow without killing the vitest worker. Commit `e802fba`.

### #D — Client hardcoded `ws://` regardless of page protocol

**File:** `src/lib/net/useGameSocket.ts`

**What was wrong.** `ws://${window.location.host}`. Works on localhost. Blocks as mixed content on every HTTPS deploy, which is exactly what Section 7 (AWS + Let's Encrypt) will produce.

**Fix.** Pick `wss:` when `window.location.protocol === 'https:'`. Commit `43fe846`.

### #E — `removeMember` during `phase === 'playing'` stalled the game silently

**File:** `server/src/room/manager.ts`

**What was wrong.** `removeMember` had no phase guard. Calling it mid-game flipped the slot to `{ kind: 'open' }` but left the seated player in `room.game.players`. Dispatch refused every action from that sessionId (slot kind no longer `human`), and the bot path wouldn't pick up (`botControlled` only applies to `human`-kind slots). When the current turn reached the ghost seat, the game stalled permanently. A pre-existing Section 4 REST-surface bug that Section 3 exposed the moment a player could actually be mid-game.

**Fix.** `removeMember` throws `RoomError('phase', ...)` → HTTP 409 when `phase === 'playing'`. Players quit mid-game by disconnecting; grace + bot handles the seat. Commit `b230adf`.

## Important findings

### #G — `finishGame` left grace timers armed

**File:** `server/src/room/manager.ts`

`finishGame` marked the phase finished and scheduled cleanup, but didn't `clearAllGraceTimers(room)`. A still-armed 60-second grace timer would then fire against a finished game, flip `botControlled`, and queue a pointless bot turn that logged a `broadcastState` no-op. Pure hygiene, but the kind of drift that breaks the bot subsystem later. Commit `948e86f`.

### #H — `setSlot` leaked `sessionIndex` on human→ai / human→locked

**File:** `server/src/room/manager.ts`

Originally the `sessionIndex.delete` + `kickedSessionIds.add` cleanup only fired on `desired.kind === 'open'`. If the host promoted a seated human to `ai` or `locked`, the displaced session's `sessionRoomId` mapping stayed stale, so that session hit `sessionAlreadySeated` when trying to join any other room. Lifted the cleanup out of the open-only branch. Commit `182fdd9`.

### #I — 4003 was terminal, so pre-start races froze the client

**File:** `server/src/game/handshake.ts`, `src/lib/net/protocol.ts`

Handshake closed pre-start and post-finish rooms with 4003 ("invalid session"), which the client treats as terminal and refuses to retry. A tab that dialed a tick before `POST /game` would freeze on a "Connection closed" screen. Split to 4006 ("room not playing") for phase mismatches, which stays out of `TERMINAL_CLOSE_CODES`. Commit `c4a9b7a`.

### #J — Outbound queue persisted across room navigations

**File:** `src/lib/net/useGameSocket.ts`

`outboundRef` survived effect re-runs. Navigating from room A to room B flushed the old queue into the new socket's `onopen` handler, producing a burst of `notYourTurn` errors. Clear it in cleanup. Commit `90fa7e8`.

### #K — `actionError` conflated with close codes in `lastError`

**File:** `src/lib/net/useGameSocket.ts`

Server `actionError` messages were stored as `{ code: 0, reason }` in the same `lastError` state used for close events. UIs couldn't tell "your last move was illegal" from "the socket just closed with 1008" — and could show the wrong banner after a transient actionError. Split into `lastActionError`. Commit `01ef2e5`.

### #L — Private-room sockets leaked on cleanup paths

**Files:** `server/src/room/manager.ts`, `server/src/index.ts`

The second audit's #C2 fix (close game sockets on `roomRemoved`) was visibility-gated — private rooms never fired `roomRemoved`. With #E now blocking mid-game member removal, the remaining exposed path was any `deleteRoom` on a private room. Added a private internal `roomClosed` event on `RoomManager` (separate `EventEmitter`, not routed through the lobby bus) that `GameRegistry` subscribes to unconditionally. Fires from both `deleteRoom` and `finishGame`. Commit `e0c55c3`.

### #M — No rate limit on the WS upgrade path

**File:** `server/src/game/handshake.ts`

REST endpoints had a per-(bearer+IP) token bucket. Handshake had none. A scripted attacker could hammer the upgrade path — each rejected 4003 still costs TCP + HTTP-upgrade round-trips + a session lookup. Added `gameUpgrade` limits (capacity 10, 2/s sustained) keyed on `socket.remoteAddress`. Commits `4986ae8` + follow-up `96f8615` narrowing `Duplex → net.Socket` to access `remoteAddress`.

### #N — `GameConnection.send` logged on benign peer-close races

**File:** `server/src/game/connection.ts`

When the peer initiated the close, ws entered `CLOSING` before our `handleClose` flipped `this.closed`. Broadcasts in that window hit `sendAfterClose`, which fired the async callback with an error, which logged a `sendError` + called `ws.terminate()`. Test logs showed one per disconnect. Added a `this.ws.readyState !== this.ws.OPEN` guard before the send. Commit `7e15298`.

### #O — `hello` followed by an immediate self-targeted `state` on attach

**File:** `server/src/game/connection.ts`

`attach()` sent `hello` to the new socket, then called `broadcastState()` which iterated *all* connections in the room, including the one that just received `hello`. Client got a hello + duplicate state back-to-back. Added an `exceptSessionId` parameter to `broadcastState`. Commit `d04cf6e`.

## Nits / defense-in-depth

### #T — 1008 was not client-terminal

Server kicks for rate-limit / illegal-action spam use 1008. Without 1008 in `TERMINAL_CLOSE_CODES`, the client reconnected into the same kick. Added 1008. Commit `97d1c80`.

### #U — Upgrade early-returns leaked the `onSocketError` listener

Handshake early-exit paths called `socket.destroy()` without removing the error listener they'd just attached. Benign (GC reaps) but inconsistent with the three `handleUpgrade` callback paths that did clean up. Refactored every early exit through a `bail(response?)` helper that removes the listener before destroy. Commit `0edd9df`.

### #V — `new URL(req.url, 'http://' + req.headers.host)` trusted the Host header

Only pathname + searchParams were read today. Pinning the base to a fixed placeholder prevents a future reader from absorbing a spoofed Host into `url.origin` or `url.host`. Commit `29859bb`.

## Deferred from audit 3

- **#F — sessionId in the URL query string.** nginx, browser history, and operator-side log pipelines see it. Proper fix needs cookie or `Sec-WebSocket-Protocol` plumbing across REST, client, and nginx — pairs naturally with Section 7 (AWS deploy), and is far less urgent now that A1/A2/A3 stopped the server from broadcasting sessionIds in the first place.

## Lessons

- A type or function named `*View` / `*Public` is a naming claim, not a verified invariant. Read the return value before trusting it across a trust boundary.
- Tests that manually clean up shared resources before teardown mask ordering bugs in the teardown path. Add at least one teardown-with-live-state case per subsystem that owns async cleanup.
- "Not blocking" deferrals have cumulative cost. The #L private-room leak, the #F URL query, and the #E ghost-seat were all flagged as "probably fine for v1" by earlier passes; together they meant a private-room playing game could silently stall, leak sockets, and hand sessionIds to the nginx log all in the same deployment.
- The single best cheap defense against this class of leak is a ratchet test: `expect(JSON.stringify(view)).not.toContain(secret)`. The seed leak had been shipped to main before the third audit caught it and the regression test went in.

---

# Audit 4 — fresh-reviewer pass

A fresh reviewer ran after audits 1–3 shipped, with explicit context that Codex had run three self-audits. The brief: verify every prior claim against the code (don't trust the doc), then pressure-test beyond it. Outcome:

- **35+ prior claims checked.** All held except one — audit-1 C1's scope was partial. See C1 below.
- **One new Critical** (C1 below): duplicate-session reconnect stomped live slot state. Regression reproducer landed.
- **Test gaps surfaced** for the single defenses that were untested (origin check, grace→bot pipeline, gameEnded→4005).
- **Two dead-code duplications** and one missing test helper surfaced as cheap wins.

## Critical

### #C1 (audit-4) — handleClose stomps live connection's slot state after duplicate-session eviction

**File:** `server/src/game/connection.ts:222-248`

**What was wrong.** Audit-1 C1 decoupled `handleClose` cleanup from the `close()` guard via `this.cleanedUp`, and audit-1 I3 made duplicate-session eviction synchronous at the registry. Neither prevented the stale connection from mutating slot state on its own `'close'` event. The sequence:

1. Second connection for the same sessionId arrives.
2. Handshake sync: `registry.remove(existing)` + `existing.close(4004, 'duplicate session')`.
3. `wss.handleUpgrade(...)` sync: new `GameConnection.attach()` runs → `slot.connected = true`, `cancelGrace`, `registry.add(new)`.
4. Event loop turn ticks — old socket's `'close'` event fires.
5. Old conn's `handleClose` runs with no ownership check. Unconditionally `slot.connected = false`, `startGrace(...)`, `broadcastState()` — stomping the live connection's slot state and arming a 60 s grace timer against an open socket.

**Reviewer verified with a 30-line vitest reproducer.** Slot ended with `connected: false` and `graceDeadline` set; the live reconnected user was then refused every action by `dispatch.ts:77-89` because `slot.connected === false` trips `notConnected`. The reconnected tab became a dead tab.

**Fix.** Two-gate ownership check before the slot mutation:
```ts
const slot = this.room.slots[this.slotIndex];
if (!slot || slot.kind !== 'human' || slot.sessionId !== this.sessionId) return;
if (this.registry.findBySession(this.room.id, this.sessionId) !== undefined) return;
slot.connected = false;
// ... arm grace, broadcast
```

The `sessionId` match rules out a slot already displaced by `setSlot`. The `findBySession` check rules out the duplicate-session race: if a newer connection is registered for this sessionId, we're the stale one — exit quietly.

**Regression:** `server/tests/game/handshake.test.ts` — "stale close after duplicate-session kick leaves live slot state intact". Reviewer-authored reproducer confirmed to fail on the un-guarded code and pass with the guard.

## Important

### #I1 (audit-4) — no test for the origin-check CSWSH defense

**File:** `server/tests/game/handshake.test.ts`

Pre-audit-4, zero tests covered the `handshake.ts:75-79` origin check. Browser `new WebSocket(...)` locks the Origin header to the page origin, so unit tests built on the `ws` client couldn't spoof it. Added a raw TCP Upgrade test that writes an HTTP/1.1 handshake request with a deliberately-wrong Origin and asserts the `HTTP/1.1 403 Forbidden\r\n\r\n` line the `bail` helper writes back.

### #I2 (audit-4) — fullFlow coverage only exercised the happy path

**Files:** `server/tests/game/fullFlow.test.ts`, `server/src/game/grace.ts`

Pre-audit-4, `fullFlow.test.ts` had one scenario — chat + disconnect-and-reconnect-before-grace. The grace→bot pipeline, the `roomClosed` → 4005 close-all path, and the `onAfterCommit` game-end flow were only tested piecewise in unit tests (`grace.test.ts`, `bot.test.ts`). Added:

- **grace→bot takeover:** client disconnects → wait for peer `state` with `botControlled: true` → wait for peer `state` with bumped `stateVersion` (bot played).
- **finishGame → 4005:** call `manager.finishGame(roomId, 'winner')` with both sockets attached → both receive close 4005.

Required a test-only `__setGraceMsForTest(ms)` helper in `grace.ts` so the integration test can run the 60 s production window on a 150 ms budget. Production paths never touch the override — it's a `null` sentinel read inside `currentGraceMs()`, with an `afterEach` reset in the test file.

### #I4 (audit-4) — redundant close path on game-end

**File:** `server/src/game/connection.ts:183-199`

After audit-3 #L wired the `roomClosed` subscriber (which fires on `finishGame` → closes every game socket with 4005), the 150 ms `setTimeout` that `onAfterCommit` used for its fallback 4005 close became dead code. Both paths fired after every winning move, with the subscriber reliably beating the timer and leaving the timer to iterate an already-empty registry. Removed the timer; the `ws` library serializes the in-flight `gameEnded` frame before the close frame, so clients still receive both in order.

### #I5 (audit-4) — setSlot human-displacement has no WS cleanup wiring

**Files:** `server/src/room/manager.ts`, `server/src/index.ts`

`setSlot` is gated to `phase === 'waiting'` and the handshake rejects pre-playing rooms with 4006, so no live `GameConnection` should exist at displacement time today. But that makes displacement cleanup a load-bearing invariant of the handshake gate — one that isn't documented and won't survive a future change that opens WS during lobby chat.

Added `RoomManager.onMemberDisplaced(handler)` as a typed subscription on the existing internal `EventEmitter`. `setSlot` emits `memberDisplaced` on any `human → open/ai/locked` transition (co-located with the existing `sessionIndex.delete` + `kickedSessionIds.add`). `server/src/index.ts` subscribes: look up the session's live `GameConnection` and close it with 4002 `'kicked'`. Belt-and-suspenders — if displacement ever happens with a live socket, the socket closes deterministically instead of lingering.

### #I6 (audit-4) — `uncaughtException` left sockets on a 1006 close

**File:** `server/src/shutdown.ts:60-75`

Audit-2 doc #13 correctly changed the `uncaughtException` / `unhandledRejection` handlers to synchronous (Node's explicit guidance). But with no socket sweep before `onExit(1)`, the process tore down TCP sockets without sending a close frame — every client saw 1006 (abnormal close), indistinguishable from a network flap. Added a synchronous `sweepSocketsSync()` that iterates `gameRegistry.allConnections()` and calls `conn.close(1011, 'server error')` on each. `ws.close()` queues the close frame into the outbound TCP buffer synchronously, so typically the bytes land before the process dies — clients see 1011 and know the server crashed.

## Minor

### #M1 (audit-4) — implicit-any under root tsc

**Files:** `server/src/game/view.ts`, `server/src/game/mapping.ts`

Follow-up #13 in `CLAUDE.md` notes that the repo-root `tsconfig.json` picks up `server/` files without the `@engine/*` path alias (which lives in `server/tsconfig.json`). Under root tsc, the engine imports fail to resolve and every downstream type collapses to `any`, which in turn trips `noImplicitAny` on callback parameters. Added explicit types to the three callbacks in `view.ts:66-67` (`partnership.teams.map((team: string[]) => team.map((id: string) => ...))`) and `mapping.ts:15` (`players.findIndex((p: { id: string }) => ...)`). Root tsc now only reports the pre-existing `@engine/*` TS2307 errors; no implicit-any cascade on new files.

Proper fix still deferred to follow-up #13 (teach root tsconfig the alias, or exclude `server/**`).

### #M3 (audit-4) — 1003 and 1009 missing from client TERMINAL_CLOSE_CODES

**File:** `src/lib/net/protocol.ts`

A buggy client that sends binary frames gets a 1003, reconnects, sends another binary frame, gets another 1003 — kick loop. Same shape for 1009 (message too large). Not an attacker primitive (the server still kicks), but wastes a full handshake round-trip on every retry. Added both to `TERMINAL_CLOSE_CODES` with a comment explaining the pattern.

### #M5 (audit-4) — `broadcastCloseAll` mutated `rooms` Map during iteration

**File:** `server/src/game/registry.ts:44-53`

Audit-2 doc #7 fixed this exact pattern in `forEachInRoom` (snapshot via `[...set]` before iterating). `broadcastCloseAll` was still iterating the Map directly with inline `this.rooms.delete(roomId)`. ECMAScript Map iterator semantics make this safe today (already-yielded entries aren't affected), but a sync close handler could re-enter and add a new entry mid-iteration. Snapshot entries up front, clear the map, then iterate. Same pattern as the `forEachInRoom` fix.

### #M6 (audit-4) — view ratchet test only ran the 2-player partnership layout

**File:** `server/tests/game/view.test.ts`

The audit-3 A1/A2/A3 keystone test `expect(JSON.stringify(view)).not.toContain(secret)` was the single cheapest defense against regression. It only ran on a `[human, human]` partnership layout, which exercises a narrow slice of the mapping layer. Added a parallel test with `[human, locked, human, ai]` at `maxPlayers: 4` — same `JSON.stringify` ratchet, verified for two distinct viewers (Alice at slot 0, Carol at slot 2), plus `youSlotIndex` round-trip. Non-trivial player indices and non-human middle seats now covered.

## Deferred

Not part of this pass; still open:

- **Minor M-2** (reviewer): `server/src/game/connection.ts` logs include `sessionId` on every attach/detach/rate-limit/action-error event. If logs ship to a third party (pm2, docker, log aggregator), sessionIds leak there even with the wire view scrubbed. Already acknowledged as deferred to Section 7 in audit-3 #F.
- **Minor M-7** (reviewer): no React-level test driving `useGameSocket` through mount/unmount/visibility/close cycles. Test gap but not a bug — the bulk of hook logic is already covered by `computeReconnectDelay` and `shouldReconnect` unit tests.
- **Minor M-8** (reviewer): chat sanitizer in `dispatch.ts:19-21` still doesn't strip C1 control chars / U+2028/U+2029 / zero-width. Safe because no client path renders chat via `dangerouslySetInnerHTML`. Acknowledged in audit-1 and here; defer to a future hardening step.

## Lessons (audit 4)

- **"LLM self-audit docs describe what the LLM claims to have fixed, not what the code does."** 35+ claims in this doc were verifiable — all held — but the one exception (C1's scope) was the live Critical. Fresh reviewers must verify, not trust.
- **Regression tests for the single defense.** Origin check, grace→bot pipeline, gameEnded→4005 were all single-defense code paths with zero coverage until audit-4 added them. The ratchet test from audit-3 was the cheapest high-ROI defense added in the whole branch; audit-4 extended the same pattern.
- **Dead-code duplications stack up.** Once audit-3 #L wired `roomClosed` → 4005, the earlier `onAfterCommit` setTimeout became strictly dead. Deleting it was cheap; leaving it invited a future "which 4005 close wins?" bug when the subscriber is refactored.
- **Test-only helpers are cheap when the alternative is real-time.** Production grace is 60 s; a unit test that waits 60 s is unshippable. `__setGraceMsForTest(ms)` is a 5-line module override that unblocks integration testing without threading DI through every call site. Acceptable because the override is `null` by default and production reads `currentGraceMs()` uniformly.
