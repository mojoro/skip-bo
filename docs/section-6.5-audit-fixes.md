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

- Server suite: 148/148 after round 2 (was 142 after round 1, 139 before fixes; +9 regression tests).
- Root suite: 139/139 after round 2 (+1 for the seated-session resume/disable behavior).
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
