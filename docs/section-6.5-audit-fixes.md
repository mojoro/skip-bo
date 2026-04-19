# Section 6.5 audit — findings and fixes

Single-pass audit of branch `feature/section-6.5-lobby`, implemented by a Sonnet 4.6 orchestrator against `docs/superpowers/plans/2026-04-19-lobby-and-pregame-room.md`. The lobby + pre-game room machinery itself came together cleanly; the audit caught one critical pre-existing security leak that Section 6.5 newly exposes to the browser, two broken partnership code paths, and two smaller cleanups.

## Commit trail

| Commit | Fix |
|---|---|
| `b9bc7d9` | Strip seed and sessionId teams from RoomInfo projection |
| `de52f67` | Narrow client RoomInfo.config to the publicized wire shape |
| `8dfe137` | Auto-build partnership teams at startGame from the seated slot order |
| `f7fc368` | Omit partnership from PreGameRoom config patch body |
| `1ee7afd` | Log broadcast fan-out errors instead of swallowing them silently |
| `f2d8486` | Rename waitingStateChange event to roomStateChange for accuracy |
| `df4efb0` | Allow self-leave during play via bot-takeover of the seat (UX round 2) |
| `09d7a14` | End abandoned games when no live human remains (UX round 2) |
| `4916ab8` | Add GET /v1/me/room for session-to-room lookups (UX round 2) |
| `76c733a` | Add useMySessionRoom hook with focus-driven refetch (UX round 2) |
| `5082f67` | Surface resume-your-game banner and disable joins when seated (UX round 2) |
| `50dfaab` | Add Leave game button to the in-play Board header (UX round 2) |
| `d9f1fa6` | Count explicit AI slots toward startGame player minimum (UX round 3) |
| `4b0f99a` | Treat finished rooms as unseated in GET v1 me room (UX round 3) |
| `8a79127` | Always fill open slots with AI at startGame so solo vs bot works (UX round 4 — superseded) |
| `fadc3d2` | Drive bots after REST state changes so bot-first games progress (UX round 5) |
| `22fa43f` | Restore allowAiFill gate on open-seat conversion at startGame (UX round 5) |
| `b930aa0` | Show room join code in the waiting room with copy-to-clipboard (UX round 6) |
| `ce80bb4` | Resolve game server base URL from the page hostname for LAN play (UX round 7) |
| `a0a357e` | Allow LAN origins in Next dev via allowedDevOrigins (UX round 7) |
| `63e1c32` | Count lobby subscribers toward the players online stat (UX round 8) |
| `f7c4df8` | Fall back to getRandomValues for sessionId when randomUUID is missing (UX round 9) |
| `127b615` | Fall back to execCommand copy when clipboard API is unavailable (UX round 9) |

## Findings

### C1 (Critical — security). `projectRoomInfo` leaked `seed` and partnership sessionIds

**Bug.** `server/src/room/slots.ts:projectRoomInfo` returned `config: room.config` unchanged. That RoomInfo rides every `/v1/rooms` and `/v1/rooms/:id` response plus every SSE `roomAdded` / `roomUpdated` event on `/v1/lobby/stream`. The SSE feed takes no auth at all. Two leaks on the same surface:

- **`config.seed`** — the mulberry32 seed that drives shuffles and per-action RNG. For rematch rooms (`manager.ts:333` sets `seed: Math.floor(Math.random() * 0xffffffff)`) it's always populated and leaks the future shuffle before the game starts.
- **`config.partnership.teams`** — stored as engine player ids, which for humans are sessionIds. SessionIds are the bearer token the REST + handshake layers trust for seat identity; exposing them to the lobby feed is a direct seat-takeover vector.

Section 3's A1/A2 ratchet (`server/src/game/view.ts:publicizeConfig`) already sanitizes the game-WS broadcast path. REST and SSE bypassed it entirely. Pre-existing bug, not introduced by 6.5, but 6.5 is the first release that ships a browser subscriber to those endpoints.

**Fix.** Added `publicizeRoomConfig(room: Room): PublicRoomConfig` in `server/src/room/slots.ts` — strips `seed` via destructuring (so any future field addition trips TypeScript) and remaps `partnership.teams` through `slotIndexForPlayerId`. `projectRoomInfo` now returns the public shape. Server `RoomInfo.config` type widened to `PublicRoomConfig`. Client `RoomInfo.config` narrowed to `PublicGameConfig` for parity. New regression tests in `server/tests/http/rooms.test.ts` verify:
- GET `/v1/rooms` response never has `config.seed` for a seed-carrying room.
- GET `/v1/rooms/:id` remaps partnership teams to slot indices and the serialized response contains no raw sessionId strings.

**Files:** `server/src/types.ts`, `server/src/room/slots.ts`, `src/lib/net/protocol.ts`, `server/tests/http/rooms.test.ts`.

### B1 (Critical — broken feature). Could not create partnership rooms from the lobby

**Bug.** `src/components/lobby/CreateRoomForm.tsx:28` submits `teams: []` whenever `partnershipEnabled`. The Zod schema on the server required `teams.min(2)`, so every partnership-room POST returned 422 "Unprocessable". Symptom: the UI appears to work, then fails with no recourse.

**Root cause (spec gap).** Partnership teams reference engine player ids — for humans, those are sessionIds. At room-create time only the host's sessionId is known; other teammates join later. The client cannot build a complete `teams: string[][]` payload up front. The plan didn't address the create-time → seat-time mismatch, so the implementation shipped with placeholder empty teams that the Zod schema correctly rejected.

**Fix.** Relaxed the Zod constraint to accept any `teams: string[][]` shape, including empty. Moved team resolution into `server/src/room/lifecycle.ts:initializeGameState` via a new `resolvePartnership(stored, playerIds)` helper: if the stored teams still reference the real (post-seating) player id set and partition every player, use them as-is; otherwise auto-pair opposite seats with `buildAutoPartnershipTeams` (matches the `buildPartnershipFromSettings` pairing rule in the client's `NewGameModal`). 2-player partnership rooms still work (pre-built teams of 1 pass the validity check); 4/6/8-player lobby-created rooms get auto-paired from slot order. Added `lifecycle.test.ts` regression asserting teams like `[[h,b],[a,c]]` on a 4-player room after `startGame`.

**Files:** `server/src/http/schemas.ts`, `server/src/room/lifecycle.ts`, `server/tests/room/lifecycle.test.ts`.

### B2 (Broken feature). PreGameRoom partnership config edits always failed

**Bug.** `src/components/room/PreGameRoom.tsx:69` forwarded `teams: props.config.partnership?.teams ?? []` in the PATCH body. The wire shape is `number[][]` (slot-indexed after publicization); server Zod expects `string[][]`. Every host config-save on a partnership game returned 422.

**Fix.** PreGameRoom's patch body no longer carries `partnership` at all. The server rebuilds teams at `startGame` regardless of stored shape (B1), and partnership-flag toggling mid-waiting was out of scope. Widened `PatchRoomInput.patch.config` from `GameConfig` to `Partial<GameConfig>` in `api.ts` so callers can send only the fields they're editing without a structural cast.

**Files:** `src/components/room/PreGameRoom.tsx`, `src/lib/net/api.ts`.

### M1 (Medium). `broadcastRoomState` silently swallowed per-connection errors

**Bug.** `server/src/game/broadcast.ts:14` caught `_err` and discarded it. The pre-existing `connection.ts:broadcastState` logged these via `log.warn({...}, 'buildGameView failed during broadcast')`. The new helper lost that observability — a bad socket would fail invisibly until someone noticed downstream state drift.

**Fix.** Added a `logger.child({ component: 'gameWs.broadcast' })` at module scope and `log.warn({ err, roomId, sessionId }, 'buildGameView failed during broadcast')` on catch.

**Files:** `server/src/game/broadcast.ts`.

### M2 (Medium). Misleading `onWaitingStateChange` event name

**Bug.** The event fires on waiting-phase mutations *and* on `startGame` (which transitions to playing). The name suggested waiting-only, but `index.ts` relies on the same subscriber to transition pre-game sockets into the Board at start. Reading the name in isolation would mislead a future maintainer.

**Fix.** Renamed `onWaitingStateChange` → `onRoomStateChange`, `waitingStateChange` → `roomStateChange` on the internal event bus. Updated subscriber in `index.ts` and the test harness in `broadcast.waiting.test.ts`. Comment rewritten to name both responsibilities (waiting mutations + start transition).

**Files:** `server/src/room/manager.ts`, `server/src/index.ts`, `server/tests/game/broadcast.waiting.test.ts`.

## Verification

- Server suite: 153/153 through round 9 (was 139 before fixes; +14 regression tests total).
- Root suite: 142/142 through round 9.
- Server typecheck: clean.
- Root typecheck: unchanged — pre-existing follow-up #13 only.
- Server typecheck: clean.
- Root typecheck: still fails only on pre-existing follow-up #13 (`@engine/*` alias under `server/`), unchanged.
- Not browser-verified: fixes are on wire-shape + server internals; existing Playwright walk-through from Task 26 still describes the UI end-to-end behavior.

## Round 2 findings — lifecycle & navigation gaps

The initial lobby shipped without enough affordances to recover from an in-progress game. Two browsers that joined each other and then navigated back to `/` both (a) saw the lobby but could not create or join another room because `sessionAlreadySeated` still held, and (b) had no link back to their active room. When both humans wandered off, the grace timers flipped both seats to bot-controlled and the game ran AI-vs-AI to completion in an empty room.

### C2 (Critical — lifecycle). No way to leave an in-progress game

**Bug.** `Board` during play exposed no "leave game" affordance; closing the tab was the only out. Combined with the sessionIndex binding, that produced the "locked in a ghost room" state described above.

**Fix.** `removeMember` now accepts self-leave during `phase === 'playing'`: the seat flips to `botControlled = true`, any grace timer is cleared, the sessionIndex entry is freed, and host migration runs if the leaver was host. `/rooms/[roomId]` renders a "Leave game" button in the Board header while `view.phase === 'playing'` (via a new `Board.headerAction` prop), wired to `leaveRoom()` + `router.push('/')`. Behind a `window.confirm` so an accidental click doesn't forfeit.

**Files:** `server/src/room/manager.ts`, `server/tests/room/manager.test.ts`, `server/tests/room/lifecycle.test.ts`, `src/components/Board.tsx`, `src/app/rooms/[roomId]/page.tsx`.

### C3 (Critical — lifecycle). Abandoned rooms ran AI-vs-AI forever

**Bug.** When every human in a playing room ended up bot-controlled (grace-expiry or explicit leave), nothing ended the game. Bots played each other to a winner over a room no live player was watching. The only cleanup trigger was the post-finish 5-minute timer, which only fires *after* `finishGame` runs — never reached for fully-abandoned games.

**Fix.** New `RoomManager.tryEndAbandonedGame(room)`: scans `room.slots` for a human entry with `botControlled === false`. If none exists and the room is still playing, calls `finishGame(roomId, 'abandoned')` (which triggers the existing cleanup path). Invoked from both terminal branches that can produce all-bot state:
- `connection.ts:handleClose` inside the grace-expiry callback, right after `migrateHostAwayFromBot`.
- `RoomManager.removeMember` on playing-phase self-leave, right after the seat flip.

The definition of "live human" deliberately excludes `botControlled === true` but includes disconnected-but-in-grace sessions, so a transient flap doesn't abandon the game out from under a reconnecting player.

**Files:** `server/src/room/manager.ts`, `server/src/game/connection.ts`, `server/tests/room/lifecycle.test.ts`.

### C4 (Critical — UX). Seated sessions had no way back to their room

**Bug.** After navigating to `/` (via the browser back button or the WinModal's "Play online" CTA), a session that was still bound to an active room saw the full lobby but every "Join" and "Create" call failed with `409 sessionAlreadySeated`. No link existed to the active room short of browser history.

**Fix.**
- Server: `GET /v1/me/room` authenticated via Bearer sessionId, returns `{ roomId: string | null }`. Mounted ahead of the other `/v1/rooms/*` routes so path precedence doesn't shadow it.
- Client: new `useMySessionRoom({ baseUrl, sessionId })` hook that fetches once on mount and re-fetches on window `focus` + `visibilitychange` events — the browser-back case reliably fires one of those.
- `Lobby` consumes the hook. When `roomId` is set it renders a gold "You're in a game — Resume →" banner linked to `/rooms/${roomId}`, dims the create + join-by-code forms (`pointer-events-none`), and sets a `disabledReason` tooltip on every RoomCard's Join button explaining the lock.
- `roomId === undefined` (fetch in flight) is distinct from `null` (confirmed unseated) so the lobby doesn't flicker the banner in during the initial fetch.

**Files:** `server/src/http/handlers/rooms.ts`, `server/src/http/server.ts`, `server/tests/http/rooms.test.ts`, `src/lib/net/api.ts`, `src/lib/net/useMySessionRoom.ts`, `src/components/lobby/Lobby.tsx`, `src/components/lobby/RoomList.tsx`, `src/components/lobby/RoomCard.tsx`, `src/app/page.integration.test.tsx`.

## Round 3 findings — AI-slot preconditions & post-finish lobby state

Two more user-reported issues after round 2 shipped.

### C5 (Bug — blocked flow). Host toggling a slot to AI couldn't start the game

**Bug.** `RoomManager.startGame` and the client's `canStart` both gated on `humans >= 2` (with an `allowAiFill && humans + open >= 2` escape hatch). Neither counted **explicit** AI slots produced by `setSlot({ kind: 'ai' })`. So a solo host at a 4-seat table who toggled two seats to AI and locked the fourth still saw `tooFew` — even though every position was accounted for and `initializeGameState` would happily seat three players (one human, two AI).

**Fix.** Rewrote the precondition on both sides to match the engine's actual requirements:

- At least one human must be seated (an all-AI room has no owner to keep it alive).
- Playable seat count ≥ 2 where `playable = humans + explicit AI + (open slots only if allowAiFill)`.
- Remaining open slots when `allowAiFill === false` still block the start.

Client `StartButton.canStart` mirrors the server rule and its tooltip now distinguishes the three failure modes (no human, open slots + no fill, under two playable). Added regression test: solo host + one AI + two locked slots now returns `true`.

**Files:** `server/src/room/manager.ts`, `server/tests/room/lifecycle.test.ts`, `src/components/room/StartButton.tsx`, `src/components/room/StartButton.test.tsx`.

### C6 (Critical — UX). Finished game blocked the session from creating a new room

**Bug.** Section 6's fix kept sessionIndex entries alive through the post-finish 5-minute cleanup so rematch requests could come over the still-open socket. The Round-2 "resume banner" then read sessionIndex and flagged the session as seated in a finished room. Combined effect: user clicks "Back to lobby" after a game ends → lobby disables Create + Join (because `sessionAlreadySeated`) but doesn't show the resume banner either, because… well, Round 2 *did* show the banner, pointing at the finished room — but C6 makes it worse: POST create still rejects with `409 sessionAlreadySeated` from the server-side `sessionIndex.has(...)` guard in `RoomManager.create`. Until the 5-minute cleanup timer fired, the session was lobby-locked with no recourse.

**Fix.** Two matching changes:

- `GET /v1/me/room` now checks the referenced room's phase; finished rooms report `{ roomId: null }`, so the lobby treats the session as free. Direct URL reconnects still work for any user who wants to hit the WinModal's rematch CTA.
- Server-side `RoomManager.create` and `addMember` now call `isSessionSeatedElsewhere(sessionId)` instead of `sessionIndex.has(...)`. The helper opportunistically drops stale pointers to finished or already-deleted rooms and returns `true` only when the mapped room is still `waiting` or `playing`. Net effect: once your game finishes, you're free to create or join another room immediately.

New regression tests:
- `server/tests/http/rooms.test.ts` — `GET /v1/me/room` reports null for a finished room even when sessionIndex still points there.
- `server/tests/room/lifecycle.test.ts` — session freed from a finished room can create a new one.

**Files:** `server/src/http/handlers/rooms.ts`, `server/src/room/manager.ts`, `server/tests/http/rooms.test.ts`, `server/tests/room/lifecycle.test.ts`.

## Round 4 — solo-vs-bot start

### C7 (Bug — blocked flow). Solo host couldn't start a game vs bots

**Bug.** `startGame` still rejected with `openSlots` when `room.allowAiFill` was `false` and open seats remained. The lobby's "Create room" form defaults `allowAiFill` to off, so a host who wanted to play immediately against bots had to either toggle the flag or manually setSlot every open seat to AI. Neither was obvious, so the reported flow — create room, click Start — failed with a user-facing `tooFew` / `openSlots` toast.

**Fix.** `startGame` no longer consults `allowAiFill` at start time. Any open seat is filled with AI unconditionally. The remaining preconditions are `humans >= 1` (a room needs an owner) and `humans + ai + open >= 2` (engine needs two players). `canStart` mirrors the simpler rule; `allowAiFill` stays in the signature for API stability but is ignored. Tooltip on the Start button now says "open seats will be filled with AI" when any remain.

Tests updated: the previous "rejects with <2 players and no ai fill" now tests the equivalent failure (solo host + every other seat locked). A new regression covers the user's exact flow — 2-seat room, solo host, `allowAiFill: false`, Start → playing, slot 1 is AI.

**Files:** `server/src/room/manager.ts`, `server/tests/room/lifecycle.test.ts`, `src/components/room/StartButton.tsx`, `src/components/room/StartButton.test.tsx`.

## Round 5 — bot-first games hang + narrowed AI-fill scope

### C8 (Critical). Bot with the first turn never played

**Bug.** `startGame` initialized the engine state + broadcast the opening view, but nothing kicked off `maybeRunBotTurn`. The existing bot driver was pinned inside `connection.ts:onAfterCommit`, which only runs after a human action commits or after a grace-expiry. For games where the starting player happened to be an AI seat (explicit AI or `allowAiFill` conversion), the game hung indefinitely — no state frame beyond the opening one ever arrived.

**Fix.** Extracted the `onAfterCommit` logic into a free helper `driveRoomAfterStateChange(room, registry, manager)` in `server/src/game/broadcast.ts`. It handles both branches: if the engine reports a winner, fan out `gameEnded` + call `finishGame`; otherwise schedule the next bot turn whose `onAfterMove` broadcasts and recurses back into the helper. Called from two places now:

- `server/src/index.ts` inside the `onRoomStateChange` subscriber, right after `broadcastRoomState`. This is the path that fires on `startGame` (and every other REST mutation that touches a playing room).
- `server/src/game/connection.ts:onAfterCommit` — delegates to the same helper after an action commits, removing the duplicated gameEnded + bot-schedule block.

`room.botPending` is the existing dedup; both entry points respect it so concurrent triggers don't double-schedule a turn.

Regression: `server/tests/game/fullFlow.test.ts` now includes a test that creates a 2-seat room with an explicit AI, pins `currentPlayerIndex` to slot 1, and asserts the bot moves within the 800 ms move delay without any human action. The fullFlow harness also picks up the production `onRoomStateChange` wiring (it was missing — reason the test originally timed out).

**Files:** `server/src/game/broadcast.ts`, `server/src/game/connection.ts`, `server/src/index.ts`, `server/tests/game/fullFlow.test.ts`.

### C9 (Correction). Narrowed Round 4's always-fill to an explicit-AI-only rule

**Bug.** Round 4's `8a79127` dropped the `allowAiFill` check from `startGame` entirely — any open seat auto-converted to AI on Start. User feedback: "if AI fill isn't checked, the lobby shouldn't fill empty slots with AI. The specific case I was referring to was that if the user explicitly set the slot to AI and tried to start the game, the game should start. `tooFew` is still a valid condition when AI fill is off and the remaining slots are just open."

**Fix.** Restored the round-3 behavior: `allowAiFill` gates open-seat conversion, but explicit AI slots (set by `setSlot({ kind: 'ai' })`) count toward the playable minimum regardless. Rules:

- ≥1 human must be seated.
- `playable = humans + explicit AI + (allowAiFill ? open : 0)` must be ≥2.
- If `open > 0 && !allowAiFill`, throw `openSlots` — host must toggle them to AI, lock them, or enable fill.

`canStart` and the Start button tooltip mirror the rule. The tooltip now says "Toggle open slots to AI, lock them, or enable AI fill" when the gate fails. Replaced the round-4 "solo vs AI without toggling fill" regression with a test that explicitly toggles slot 1 to AI and starts successfully.

**Files:** `server/src/room/manager.ts`, `server/tests/room/lifecycle.test.ts`, `src/components/room/StartButton.tsx`, `src/components/room/StartButton.test.tsx`.

## Round 6 — share-by-code affordance

### F1 (UX gap). Waiting room had no way to share the join code

**Bug.** The server generates a short room code at create time and lobby SSE carries it on `RoomInfo` (visible to public rooms in the list, via direct fetch for private), but the pre-game WaitingRoom had no display for it. A host using a private room could not share the code with a friend without going back to the lobby and scraping the URL.

**Fix.** `GameView` gains a `code: string` field populated from `room.code` in `buildGameView`. The `PreGameRoom` header renders a gold-bordered pill `CODE · <code>` with a "Copy" button that writes to clipboard; the label flips to "Copied" for 1.5 s. The code isn't sensitive — anyone already in the room is free to share it — so it rides the same broadcast rather than requiring a separate REST call.

**Files:** `server/src/game/view.ts`, `src/lib/net/protocol.ts`, `src/components/room/PreGameRoom.tsx`, `src/app/rooms/[roomId]/page.tsx`.

## Round 7 — LAN play

### F2 (Blocked flow). LAN peers couldn't reach the game server

**Bug.** `.env.local` pinned `NEXT_PUBLIC_GAME_{API,WS}_URL=http(s)://localhost:8787`. A phone on the LAN loading `http://<host-ip>:3000` had its browser try to open `ws://localhost:8787` — its own machine, not the host's. Even deleting the env vars didn't help: the `useGameSocket` fallback read `window.location.host`, which includes the dev server's `:3000`, not the game server's `:8787`.

**Fix.** New `src/lib/net/endpoints.ts` with `gameApiBaseUrl()` + `gameWsBaseUrl()` that resolve in this order: explicit env var (for prod deploys), else `${window.location.protocol}//${window.location.hostname}:8787` (works for both single-device dev and LAN peers), else an SSR-safe `localhost:8787`. All three callsites (`useGameSocket`, `app/page.tsx`, `app/rooms/[roomId]/page.tsx`) now route through the helpers. `.env.local` got commented-out hints for prod use.

Also added `allowedDevOrigins: ['192.168.0.29', 'localhost', '127.0.0.1']` to `next.config.ts` so the Next dev server accepts cross-origin requests from LAN peers.

**Files:** `src/lib/net/endpoints.ts`, `src/lib/net/useGameSocket.ts`, `src/app/page.tsx`, `src/app/rooms/[roomId]/page.tsx`, `.env.local`, `next.config.ts`.

## Round 8 — players-online count

### F3 (UX gap). Lobby subscribers not counted as online

**Bug.** `RoomManager.stats().playersOnline` only counted humans with `slot.connected === true`. A person browsing the lobby who hadn't joined a room was invisible to the "N online" chip — misleading since they're plainly online.

**Fix.** `LobbyStreamRegistry.sessionIds()` and `RoomManager.seatedSessionIds()` / `gamesInProgress()` expose the underlying data. `startStatsTicker` unions both sets (Set-based dedupe so a session that's both seated and subscribed counts once) and publishes the composite via the existing `statsUpdate` event. Propagates through the 2-second poll cadence already in place.

**Files:** `server/src/sse/registry.ts`, `server/src/room/manager.ts`, `server/src/stats.ts`.

## Round 9 — LAN HTTP insecure-context APIs

### F4 (Blocked flow). `crypto.randomUUID` missing on LAN HTTP

**Bug.** `crypto.randomUUID()` is gated to secure contexts — HTTPS or localhost. A phone on the LAN loading `http://<host-ip>:3000` sees `crypto.randomUUID` as undefined, so the `useSessionId` hook threw "crypto.randomUUID is not a function" on first visit and the page never rendered past that.

**Fix.** New `src/lib/net/uuid.ts` feature-detects `crypto.randomUUID` and falls back to a `crypto.getRandomValues()`-based UUID v4 (still exposed in insecure contexts). Both `useSessionId` instances call the wrapper.

### F5 (UX polish, same root cause). Copy-code button silently failed on LAN HTTP

**Bug.** `navigator.clipboard.writeText` is also gated to secure contexts. The round-6 "Copy" button try/caught the error so it didn't crash, but the click did nothing useful on a LAN phone.

**Fix.** The button now falls back to the legacy `document.execCommand('copy')` path with a hidden textarea when `navigator.clipboard` is unavailable. Copy works on every browser on the LAN now.

**Files:** `src/lib/net/uuid.ts`, `src/app/page.tsx`, `src/app/rooms/[roomId]/page.tsx`, `src/components/room/PreGameRoom.tsx`.

## Minor findings noted but not fixed

- `useLobbyStream.ts:73` re-sorts rooms on every render. `useMemo` would trim per-render work on a large lobby; skipped as non-blocking.
- `api.ts` has no timeout/AbortController — slow server = indefinite hang.
- `useLobbyStream.ts:60` flips `connected: false` on every EventSource transient `onerror`, causing the "reconnecting" dot to flash during normal reconnect attempts.
- `api.ts:113` uses `... as Record<string, string>` to work around `HeadersInit` typing in a spread; tidier with an explicit object but functionally fine.
- `Lobby.handleJoin` has no double-click guard — rapid taps produce a `409 sessionAlreadySeated` error toast instead of a no-op.
- `rooms/[roomId]/page.tsx` mixes destructured `{ view, seats }` with direct `socket.view.xxx` reads; consistent access pattern would read cleaner.

## What went well

- Shape of the lobby + pre-game wiring is clean and matches the spec. The handshake relaxation is a 2-line diff, `broadcastRoomState` is the right abstraction, and phase-branching at `/rooms/[roomId]` stays surgical.
- Hooks (`useDisplayName`, `useLobbyStream`, `api.ts`) are small, well-tested, and framework-free.
- Tests exercise real invariants — the new broadcast test opens a real WS, drives a real `addMember`, and catches the fanned-out frame. Not a mock-heavy shell.
- Auto-build teams at startGame (B1 fix) is a cleaner lifecycle than the client-side team-shape the spec originally called for; the seat-order pairing rule lives in one place now (`buildAutoPartnershipTeams`) and the client never has to know about engine player ids.
