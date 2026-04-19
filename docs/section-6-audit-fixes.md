# Section 6 audit — findings and fixes

Single-pass audit of branch `feature/section-6-networked-board`, written by codex. The branch extracts the tabletop Board from `/local/page.tsx` into a shared `src/components/Board.tsx`, wires it into `/rooms/[roomId]` on top of `useGameSocket`, and — beyond the original CLAUDE.md scope — adds a rematch flow (protocol message, server handler, `RoomManager.createRematchRoom`, WinModal CTAs).

The audit verified the shared-Board extraction end-to-end and found two critical bugs in the rematch flow plus a regression in `/local`. All three are fixed on this branch.

## Scope decision

Rematch was not in CLAUDE.md's Section 6 scope (which called out Board extraction + rooms wiring only). Codex shipped it anyway. The scope creep was accepted — rematch is desired — but the implementation was structurally broken, so this audit fixes it rather than reverting. CLAUDE.md was updated to reflect rematch as part of Section 6.

## Commit trail

| Commit | Fix |
|---|---|
| `52dd162` | Keep game sockets alive past finishGame for rematch |
| `aad9965` | Replace WinModal rematch props with generic actions array |
| `14b14eb` | Give local WinModal Play Again, New Game, Play Online actions |
| `196a029` | Compose rematch win actions in rooms page instead of Board |
| `ea31ba8` | Refresh CLAUDE.md to reflect Section 6 shipped and lobby UI next |

## Findings

### C1 (Critical). Rematch flow unreachable in production

**Bug.** `connection.ts:onAfterCommit` sent `gameEnded` and then synchronously called `RoomManager.finishGame`. `finishGame` emitted `roomClosed` on the internal event bus, which `index.ts` turned into `conn.close(4005, 'room closed')` for every socket in the room. 4005 is in `TERMINAL_CLOSE_CODES`, so `useGameSocket` did not attempt reconnect. Client timeline:

1. `ws.onmessage` with `gameEnded` → view updates, `phase='finished'`.
2. `ws.onclose(4005)` → `status='closed'`.
3. `/rooms/[roomId]/page.tsx` early-returns `<Closed>` — Board never renders, **WinModal never renders**.
4. Even if the modal rendered in the tiny window before onclose, `requestRematch` enqueued via `useGameSocket.enqueue` onto an already-closed socket that would never reconnect. Message never delivered.

The rematch tests passed because they bypassed the real flow. `rematch.test.ts:connectAndFinish` literally commented `// Flip to finished without calling finishGame() so sockets stay alive` and mutated `room.phase` directly.

**Fix.** `RoomManager.finishGame` no longer emits `roomClosed`. Sockets stay alive through the post-game window. `deleteRoom` still emits `roomClosed` when the `FINISH_CLEANUP_MS` timer fires (~5 min post-finish), and that's what closes the sockets with 4005.

Also added `__setFinishCleanupMsForTest(ms: number | null)` to `server/src/room/lifecycle.ts` so tests can exercise the cleanup path without stalling on the 5-minute real timer. Rewrote the `connectAndFinish` test harness to call the real `finishGame` and assert sockets remain `OPEN`. Rewrote `fullFlow.test.ts`'s end-of-game pinning test: it now asserts sockets stay open past `finishGame` AND are closed with 4005 once `FINISH_CLEANUP_MS` elapses.

**Files:** `server/src/room/manager.ts`, `server/src/room/lifecycle.ts`, `server/src/game/connection.ts` (comment), `server/tests/game/fullFlow.test.ts`, `server/tests/game/rematch.test.ts`.

### C2 (Critical). `/local` wedged on win

**Bug.** Board always rendered its `WinModal` when `view.phase === 'finished'`. `/local` passed no `onRequestRematch` / `onBackToLobby` handlers; the WinModal props defaulted to `() => {}`. Both buttons were inert. The modal's `absolute inset-0 z-30` overlay sat on top of the floating "New Game" button. User could finish a game but had no way to start another without reloading the page.

**Fix.** WinModal's props replaced with a generic `actions: WinModalAction[]` array. Each action is `{ key, label, variant?, href?, onClick?, disabled? }`. Callers compose whatever action set makes sense for their context. Board now accepts a single `winActions` prop and passes it through.

`/local` composes three actions:

- **Play again** (primary) — replays with the last `NewGameSettings` the user picked, or the default two-player game if none was chosen yet.
- **New Game** — opens `NewGameModal` so the user can change config.
- **Play online** (Link) — navigates to `/`, which will grow into the lobby.

**Files:** `src/components/WinModal.tsx` (rewritten), `src/components/Board.tsx`, `src/app/local/page.tsx`.

### C3 (Critical). Rematch lived inside Board instead of the caller

**Bug.** Board took `rematchRoomId`, `onRequestRematch`, `onBackToLobby` as props — wiring the networked flow's concerns into a component that should be transport-agnostic. This prevented `/local` from composing its own action set (see C2) and bound Board's public API to the rematch feature.

**Fix.** Dropped the rematch-specific props from `BoardProps`. `/rooms/[roomId]` now owns the rematch UI state (`rematchPending` local state, action-set swap when `socket.rematchRoomId` lands, debounce to prevent double-sends) and passes `winActions` through. Board stays transport-agnostic.

**Files:** `src/components/Board.tsx`, `src/app/rooms/[roomId]/page.tsx`.

## Verification

- Shared-Board extraction: `/local` and `/rooms/[roomId]` consume the same Board via the `(view, seats, dispatch, youSlotIndex, winActions)` contract. `src/lib/view/fromEngine.ts` adapts hot-seat engine state → the `PublicPlayerView` wire shape via destructuring (`seed` drop surfaces as a TypeScript error if reintroduced). `src/lib/view/seat.ts` unifies self/opponent/empty seats into a single `SeatViewModel`.
- Wire-shape ratchet (A1 seed strip, A2 slot-indexed partnership, A3 no sessionIds on the wire) preserved. Board props never carry sessionIds or raw engine ids.
- Test suites: server **135/135**, main-app **96/96**. Server typecheck clean. Root typecheck still flags follow-up #13 (`@engine/*` alias in server/ files picked up by root `tsconfig`) — pre-existing, unchanged by this branch.
- Browser check: `/local` renders the Board at 1280×800 cleanly. `/rooms/[bogus-id]` disconnects terminally as designed.
- Not browser-verified: the three-button WinModal at a forced win state — would need to drive the engine to a winning move. Render logic is pure props → DOM and unit-covered; low risk.

## Follow-ups

- **Stale-old-URL after rematch.** If a user reloads `/rooms/[oldRoomId]` after `createRematchRoom` has retargeted their `sessionIndex` to the new room, the handshake rejects with 4003 "invalid session". Could redirect instead by consulting `GameRegistry.rematchBySourceRoom` — skipped because lobby UI doesn't exist yet so the rough edge has no reachable trigger. Revisit when lobby ships.
- **Hot-seat perspective rotation.** `/local` now silently rotates the view each turn (`engineStateToView(state, state.currentPlayerIndex)`) — only the active player's hand is face-up. Previous `/local` showed all hands. The new behavior is arguably correct hot-seat (no peeking when you pass the device), but a turn-transition banner would reduce surprise. Deferred with other UI polish.
- **`engineStateToView.isHost`.** Adapter currently sets `isHost: i === youPlayerIndex`, which in `/local` means the host chip rotates with turns. Cosmetically wrong — should be `i === 0` or something stable. Cosmetic, pre-existing, not this audit's scope.
