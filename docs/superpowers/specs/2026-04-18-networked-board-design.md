# Networked Board — Design

**Date:** 2026-04-18
**Status:** Approved (pending user review of this document)
**Scope:** Section 6 of the Skip-Bo networking design. Picks up after Sections 1 (engine), 2/3 (game WS protocol + client hook), and 4 (Room Manager + Lobby) — all shipped. This section wires the full game UI into `/rooms/[roomId]`, which currently only renders a debug view of seats and presence.

## Context

`/local` owns the complete Skip-Bo UI against a local engine: tabletop seats, drag-and-drop, build piles, wild-card picker, end-turn confirm, team colors. `/rooms/[roomId]` only renders a themed debug page built around `src/lib/net/useGameSocket.ts`. The full game UI has never run against the WebSocket.

Section 3's four-audit ratchet established load-bearing invariants on the wire protocol: no sessionIds leak to opponent sockets, partnership teams carry slot indices rather than engine player ids, per-socket `PlayerView` is authoritative. Those guarantees live in `server/src/game/view.ts` and the `PublicPlayerView` / `PublicPartnershipRules` types in `src/lib/net/protocol.ts`. The Board component we build here must preserve those guarantees at the type level — it cannot accidentally carry a sessionId into the DOM.

## Decisions locked during brainstorming

| # | Question | Answer |
|---|----------|--------|
| 1 | Local apply model | Server-authoritative. `sendAction` fires; UI waits for `state` broadcast before re-rendering. `/local` applies synchronously through the same Board. |
| 2 | Data-shape convergence | Board speaks the wire shape (`PlayerView` + `GameViewSeat[]`). `/local` adapts its engine state via a pure `engineStateToView` function. Seat is refactored to take a `SeatViewModel` derived from the wire shape. |
| 3 | DnD under latency | Release & snap-back. Ghost clears on pointer-up; card re-renders at destination when `state` arrives. No pending-ghost layer, no input blocking, no timeout. Server rejects illegal late actions via `actionError`. |
| 4 | Win UI | Modal with two CTAs: "Back to lobby" (route to `/`) and "Keep same group" (server-driven rematch). Rematch is not deferred. |
| 5 | Rematch mechanism | Server-driven, one-rematch-per-game. New `requestRematch` / `rematchReady` protocol pair. Server clones current config, creates a new room via `RoomManager`, pre-seats the finished game's humans, and starts the game immediately so the existing `phase === 'playing'` handshake gate works unchanged. |
| 6 | Rematch seating | Server pre-seats the new room with each finished-game human's `sessionId` and `name`, then calls `initializeGameState`. Slots are populated in finished-game order so table geometry stays consistent. "First to connect gets host" piggybacks on existing `migrateHostAwayFromBot` — host starts as a bot-controlled sentinel, flips to the first connecting human. |
| 7 | Rematch authorization | Any seat may request. Host-only would strand everyone if the host declined. Idempotency handles races. |
| 7b | sessionIndex migration | The new-room creation path atomically moves each seated session from the finished room's `sessionIndex` entry to the new room's. Old-room post-finish cleanup is adjusted to skip `sessionIndex` removal for sessions whose mapping now points elsewhere. |
| 8 | Test scope | Unit tests for the `engineStateToView` adapter + server-side wire tests for the rematch protocol. Board visual tests deferred to Section 8. |

## 6.1 — Architecture overview

One Board component, two drivers. `/local` adapts its engine state to the wire shape each render; `/rooms/[roomId]` passes the wire shape through from the socket.

```
/local (hot-seat)                     /rooms/[roomId] (networked)
─────────────────                     ────────────────────────────
useState<GameState>                   useGameSocket(roomId, sessionId)
      │                                     │
      ▼                                     │
engineStateToView(state,                    │
                  activeIdx)                │
      │                                     │
      └──────────► Board ◄──────────────────┘
                     (view, seats,
                      onAction,
                      onRequestRematch,
                      rematchRoomId,
                      onBackToLobby,
                      lastActionError)
                     │
                     ▼
                  DragDropProvider
                  ├─ Seat × N       (SeatViewModel)
                  ├─ MobileBoard    (for small viewports / 5+ players)
                  ├─ TableCenter    (build piles, draw pile, wild picker)
                  ├─ ConfirmDialog  (end-turn confirm)
                  └─ WinModal       (visible when view.phase === 'finished')
```

**Ratchet property preserved:** Board + Seat never import `GameState` or `PlayerState` from the engine. TypeScript enforces that sessionIds and seeds cannot bleed into the UI layer. `/local`'s `engineStateToView` is the only place engine ids get rewritten, and its return type is the wire `PlayerView` — making the rewrite load-bearing in the type system.

## 6.2 — File map

### New

- `src/components/Board.tsx` — presentational Board. Props:
  ```ts
  interface BoardProps {
    view: PlayerView;
    seats: GameViewSeat[];
    onAction: (action: GameAction) => void;
    onRequestRematch: () => void;
    onBackToLobby: () => void;
    rematchRoomId: string | null;
    lastActionError: string | null;
  }
  ```
  Owns: selection state, wild picker state, end-turn confirm state, rematch button state. Wraps itself in `DragDropProvider`. No engine import, no network import.
- `src/components/WinModal.tsx` — winner headline, "Back to lobby" button, "Keep same group" button that swaps to "Enter rematch →" once `rematchRoomId` is set.
- `src/lib/view/fromEngine.ts` — exports `engineStateToView(state: GameState, youPlayerIndex: number): { view: PlayerView; seats: GameViewSeat[] }`. Pure function. Strips seed, rewrites partnership teams from engine ids to slot indices, builds synthetic `GameViewSeat`s (kind `human`, connected true, no grace, not bot, host `= youSlotIndex`).
- `src/lib/view/fromEngine.test.ts` — adapter unit tests.
- `server/src/game/rematch.test.ts` — wire-format tests for the new protocol messages.

### Refactored

- `src/components/Seat.tsx` — takes `SeatViewModel` instead of engine `PlayerState`:
  ```ts
  interface SeatViewModel {
    slotIndex: number;
    name: string;
    handCards: Card[] | null;    // own seat: real cards; opponent: null
    handCount: number;
    stockTop: { id: string; value: CardValue } | null;
    stockCount: number;
    discardPiles: { id: string; value: CardValue }[][];
    team: { index: number; color: string } | null;
    isActive: boolean;
    isYou: boolean;
    isHost: boolean;
    presence: 'online' | 'offline' | 'grace' | 'bot' | 'ai' | 'empty';
  }
  ```
  `SeatViewModel` lives in `src/lib/view/seat.ts` alongside a `buildSeatViewModels({ view, seats, teamColors }): SeatViewModel[]` helper that Board uses once per render.
- `src/components/MobileBoard.tsx` — same treatment, consumes `SeatViewModel[]`.
- `src/app/local/page.tsx` — rewritten around `useState<GameState>` + `engineStateToView`. Keeps New Game modal, ruleset info, last-settings memory for rematch. Turn handoff: `engineStateToView` passes `youPlayerIndex = state.currentPlayerIndex` so the active player is always "you" (hot-seat semantics).
- `src/app/rooms/[roomId]/page.tsx` — rewritten. Renders Board when `socket.view` is populated; keeps existing Placeholder/Closed outer shell for connection-state screens. Wires `onAction → socket.sendAction`, `onRequestRematch → socket.requestRematch`, `rematchRoomId → socket.rematchRoomId`, `onBackToLobby → router.push('/')`. Retains the status chip and version chip in a minimal header above the Board.
- `src/lib/net/protocol.ts` — adds `requestRematch` ClientMessage and `rematchReady` ServerMessage.
- `src/lib/net/useGameSocket.ts` — adds `rematchRoomId: string | null` and `requestRematch: () => void`. `rematchRoomId` clears on `roomId` / `sessionId` change (same useEffect-cleanup path that flushes the outbound queue); sticky across plain reconnects within the same room so a brief drop during the "Creating rematch…" window doesn't lose the signal.
- `server/src/game/connection.ts` — handles `requestRematch`, validates phase, rate-limits, calls `RoomManager.createRematchRoom` when no mapping exists (reads `registry.getRematchRoomId` first for idempotency), stashes the new id via `registry.setRematchRoomId`, broadcasts `rematchReady`.
- `server/src/game/handshake.ts` — after `GameConnection` sends `hello` on attach, calls `registry.getRematchRoomId(roomId)` and, if non-null, sends a trailing `rematchReady { newRoomId }` so reconnecting-into-grace sees the link.
- `server/src/game/registry.ts` — adds `private rematchBySourceRoom: Map<string, string>` with `getRematchRoomId(sourceRoomId): string | null` and `setRematchRoomId(sourceRoomId, newRoomId): void`. Registry owns it because it already scopes state per room and survives past the finished-room cleanup window.
- `server/src/room/manager.ts` — adds `createRematchRoom({ sourceRoom, seatedHumans }): { room: Room }` method. Updates the finished-room post-cleanup `sessionIndex` bookkeeping to skip deletions for sessions whose mapping has been reassigned (compare `sessionIndex.get(sessionId) === sourceRoomId` before deleting).

### Unchanged

- `src/lib/game/engine.ts` and all engine types.
- `src/components/Card.tsx`, `DraggableCard.tsx`, `DroppableZone.tsx`, `DragGhost.tsx`, `TableCenter.tsx`, `WildDirectionPicker.tsx`, `NewGameModal.tsx`, `RulesetInfo.tsx`, `ConfirmDialog.tsx`.
- `src/lib/dnd/` (the DnD stack).
- `server/src/game/bot.ts` — random-legal stub stays; real strategy is Section 5.

## 6.3 — Data flow

### Networked (`/rooms/[roomId]`)

```
user drag/drop/click
  → Board.onAction(GameAction)
    → socket.sendAction → WS frame
      → server applyAction → broadcast state{ view, seats, stateVersion }
        → useGameSocket.view updates
          → Board re-renders from new view
```

No optimistic apply. `actionError` sets `socket.lastActionError`, which Board renders as a toast for ~3 s in the header ribbon (reuses the `message` state pattern from today's `/local`).

### Win → rematch

```
server sees winner → broadcast gameEnded{ view.phase = 'finished', winningTeamIndex }
  → Board renders WinModal
    → user clicks "Keep same group"
      → socket.requestRematch() → WS frame
        → server creates rematch room (or returns existing rematchRoomId),
          broadcasts rematchReady{ newRoomId } to all game connections
          → useGameSocket.rematchRoomId set
            → WinModal swaps CTA to "Enter rematch →"
              → click → router.push(`/rooms/${newRoomId}`) → new WS connection
```

The clicker's own client also auto-navigates when `rematchRoomId` flips non-null (same effect as clicking the link — `useEffect` on `rematchRoomId`).

### Hot-seat (`/local`)

```
user drag/drop/click
  → Board.onAction(GameAction)
    → /local's onAction wraps applyAction; ok → setState(next), err → show error toast
      → engineStateToView(next, activeIdx) rebuilds view
        → Board re-renders
```

Turn handoff is implicit: `engineStateToView` always passes `youPlayerIndex = state.currentPlayerIndex`, so after a DISCARD advances `currentPlayerIndex`, the next active player becomes "you" — the UI flips without any explicit handoff banner.

Win/rematch in hot-seat: "Back to lobby" = `router.push('/')`. "Keep same group" = `setState(makeGameFromSettings(lastSettings))` — restart with same config. `/local` page holds the last `NewGameSettings` in state so the fn has something to clone.

## 6.4 — Protocol delta

`src/lib/net/protocol.ts`:

```ts
export type ClientMessage =
  | { type: 'action'; action: GameAction }
  | { type: 'chat'; text: string }
  | { type: 'requestRematch' };                                     // new

export type ServerMessage =
  | { type: 'hello';          stateVersion: number; view: GameView }
  | { type: 'state';          stateVersion: number; view: GameView }
  | { type: 'actionError';    reason: string; stateVersion: number }
  | { type: 'chat';           fromSlotIndex: number; fromName: string; text: string; sentAt: number }
  | { type: 'gameEnded';      stateVersion: number; view: GameView; reason: 'winner' | 'abandoned' }
  | { type: 'rematchReady';   newRoomId: string };                  // new
```

### Server-side validation for `requestRematch`

- **Phase gate.** Only when `registeredGame.state.phase === 'finished'`. Otherwise emit `actionError { reason: 'game not finished' }`.
- **Idempotency.** If `registeredGame.rematchRoomId` is already set, skip creation and re-send `rematchReady` to the requesting socket only. Others already have it. `useGameSocket` treats the message as set-if-unset, so duplicate delivery is harmless.
- **Rate limit.** Reuse the existing token-bucket pattern in `server/src/server.ts` — per-sessionId, bucket and refill values mirror the in-game `action` limiter so rematch spam is bounded the same way illegal-move spam already is. Over-burst gets `actionError { reason: 'rate_limit' }`. Known follow-up: limiters are still module-level shared across tests (follow-up #9), so rematch tests use unique bearers.
- **Room creation.** New `RoomManager.createRematchRoom({ sourceRoom, seatedHumans })` method. `sourceRoom` supplies `config` (cloned structurally — same `playerCount`, `ruleset`, partnership flags; `seed` regenerated), `allowAiFill`, `visibility`. `seatedHumans` is the list of `{ sessionId, name }` pairs for every slot whose `kind === 'human'` in the finished room (connected or in grace), in original slot order. The method:
  1. Builds slots: `seatedHumans` placed in their original slot indices as `kind: 'human'` entries with `connected: false`, `botControlled: true`, no grace timer. Other slots cloned from the finished room (AI kept, open stays open, locked stays locked).
  2. Sets `hostSessionId` to an empty-string sentinel. The existing `migrateHostAwayFromBot` path flips host to the first connecting human on attach.
  3. Atomically moves each seated human's `sessionIndex` entry from the finished room's id to the new room's id. The finished room's slot state is left intact so the win modal keeps rendering correctly until cleanup; cleanup is updated to skip `sessionIndex` removal for sessions whose mapping has since been reassigned (checked by re-reading `sessionIndex.get(sessionId) === oldRoomId` before deleting).
  4. Calls `initializeGameState(room)` to deal the opening hand immediately so `room.phase === 'playing'` is satisfied by the time the first client reconnects.
  5. Returns the created room. The caller (game connection handler) stashes `newRoomId` on the registered-game entry and broadcasts `rematchReady`.
- **Broadcast target.** Every open `GameConnection` for the current registered game. Bots have no WebSocket (they dispatch server-side via `bot.ts`) and are not targeted. A human in grace has no live `GameConnection` during the grace window, so they miss the instant broadcast — but the handshake handler emits a trailing `rematchReady { newRoomId }` right after `hello` when `registeredGame.rematchRoomId` is already set, so any reconnect (within grace or long after) sees the rematch link. Since the new room is already playing with their session pre-seated, navigating there just reconnects under the normal gameplay handshake.

## 6.5 — Win modal + rematch UX

Modal overlay centered on the felt, wood-framed like existing modals. Shown when `view.phase === 'finished'`. Not backdrop-dismissible — the game is over and nothing useful sits behind it.

### Layout

```
┌─────────────────────────────────┐
│          TEAM 1 WINS            │
│   ┌───┐ ┌───┐                   │
│   │ a │ │ b │  alice & bob      │
│   └───┘ └───┘                   │
│                                 │
│   [ Back to lobby ]  [ Rematch ]│
└─────────────────────────────────┘
```

Singles headline: `ALICE WINS`. Partnership headline: `TEAM 1 WINS` with the team's member names listed below. Team strip uses the same color palette from `TEAM_COLORS` in `/local`. Board derives the headline from `view.config.partnership` (present = partnership mode): in singles, `winningTeamIndex` is the winner's slot index and the name comes from `seats[winningTeamIndex].name`; in partnerships, `winningTeamIndex` addresses `view.config.partnership.teams[winningTeamIndex]` which is a list of slot indices whose names are then looked up in `seats`.

### "Keep same group" button states

1. **Idle (pre-click):** `[ Keep same group ]` — primary gold CTA.
2. **Requested, awaiting broadcast:** `[ Creating rematch… ]` — disabled. Set locally on click; cleared when `rematchRoomId` is non-null or an `actionError` toast arrives.
3. **Ready (own click or another seat's):** `[ Enter rematch → ]` — next.js `<Link href={/rooms/${rematchRoomId}}>`. The clicker's own client auto-navigates via `useEffect` on `rematchRoomId`.

No local timeout — the server answers or the socket closes, and the existing reconnect flow handles the close. An `actionError` during the "Creating rematch…" window returns the button to idle and shows the toast.

### "Back to lobby"

Secondary button, always enabled. Click = `router.push('/')`.

### `gameEnded.reason === 'abandoned'`

Different headline — `Game abandoned` instead of `TEAM X WINS` — but same two CTAs. Abandonment happens server-side when the last human seat's grace expires and all remaining seats are AI/empty; the triggering player may still be connected long enough to see the modal before their own socket closes.

### Hot-seat degeneration in `/local`

- "Back to lobby" = `router.push('/')`.
- "Keep same group" = `setState(makeGameFromSettings(lastSettings))`. Button shows `[ Rematch ]` directly — no "Creating…" intermediate because there's no network round-trip. `/local` holds the last `NewGameSettings` in component state.

## 6.6 — Error handling

### Network-level errors

Already owned by `useGameSocket` (Sections 2/3 and the four audits). Board doesn't retry, reconnect, or close — it renders from whatever `socket.view` holds. `/rooms/[roomId]`'s outer shell keeps the existing `Closed` screen for terminal codes (1003 / 1008 / 1009 / 4002–4005) and its reconnecting chip. Board never renders on a closed socket.

### Engine-level rejections (`actionError`)

- `socket.lastActionError.reason` drives a toast in Board's header ribbon. Auto-clears ~3 s after render via `useEffect` on the string identity.
- `actionError` is non-destructive: Board stays on the pre-action view since we never optimistically applied.
- Special case: an `actionError` during the "Creating rematch…" window resets the CTA to idle and toasts the reason.

### Stale view during reconnect

- Socket goes `open → reconnecting`. `socket.view` stays on the last known state until `hello` from the new connection replaces it. Board renders normally against the stale view; the outer shell surfaces "Reconnecting" in the status chip.
- Interactions still fire. `sendAction` enqueues to the bounded outbound buffer (`OUTBOUND_CAP=32`). When the socket reopens, the queue drains. The server rejects any now-stale actions with `actionError`.
- Trade-off: user can drag during the gap and the action re-plays on reconnect. Worst case is an `actionError` toast — honest, not destructive.

### Input during opponent's turn

- Board disables DnD and click handlers on own cards when `view.currentPlayerSlotIndex !== view.youSlotIndex`. Client-rejected first to avoid noise. Existing `disabled={!isActive}` pattern in `Seat.tsx` extends through the Board shell.

### Spectator / unseated case

- If `view.youSlotIndex === -1` (wire convention for "not seated"), Board renders in spectator mode: build piles and opponent seats visible, no hand zone, no drag, no click. `/rooms/[roomId]` should rarely hit this — the handshake refuses non-seated sessionIds — but defensive rendering avoids a crash on edge cases like a host migrating away into an `open` slot.

## 6.7 — Testing

### `src/lib/view/fromEngine.test.ts` (new, main app suite)

Unit tests for the `engineStateToView` adapter. This is the audit ratchet for Section 6.

- Round-trip scrubs seed: `createGame` → `engineStateToView` → assert `view.config.seed === undefined`.
- Partnership teams remap: 4-player partnership with engine ids `["p1","p2","p3","p4"]` and teams `[["p1","p3"],["p2","p4"]]` → `view.config.partnership.teams === [[0,2],[1,3]]`.
- Opponent view shape: 3-player game, `youPlayerIndex=0` → `view.opponents.length === 2`, each opponent's `handCount` matches the engine hand length, `stockTop` matches the engine top card id, no field carrying opponent hand cards leaks.
- Seats: `seats.length === playerCount`, `seats[0].isHost === true`, all `seats[i].kind === 'human'`, `connected === true`, `graceDeadline === null`, `botControlled === false`.
- `youSlotIndex` honored: `youPlayerIndex=1` → `view.youSlotIndex === 1`, `view.you.hand` equals engine `state.players[1].hand`.
- Finished-state round-trip: `phase='finished'`, `winningTeamIndex=0` survive intact.

### `server/src/game/rematch.test.ts` (new, server suite)

Four wire-format tests.

- Finished game → any seat's `requestRematch` → all connected sockets receive `rematchReady { newRoomId }`.
- Second `requestRematch` from a different seat → that socket receives `rematchReady` with the same `newRoomId`; no new room created (verify via `RoomManager.list`).
- `requestRematch` while `phase === 'playing'` → requester receives `actionError { reason: 'game not finished' }`; no broadcast.
- Rate limit: over-burst `requestRematch` → `actionError { reason: 'rate_limit' }` on the offending session.
- Config clone: new room's config matches `ruleset`, `playerCount`, partnership flags (verify via REST `GET /v1/rooms/:id`); fresh seed in the cloned config is different from the original.
- Seat pre-seeding: new room's slots carry the same `kind` shape as the finished room — humans re-seated at their original slot indices with their original `sessionId` and `name`, AI slots cloned, open/locked preserved.
- sessionIndex migration: after rematch, `sessionIndex.get(oldSessionId) === newRoomId` for every seated human. Old-room cleanup fires and does not unset those entries.
- Phase on creation: new room is `phase === 'playing'` immediately (no lobby gate), so the next game WS handshake passes `phase === 'playing'` without any pre-join REST call.
- Host on connect: new room starts with `hostSessionId === ''` (sentinel). First human socket to attach triggers `migrateHostAwayFromBot`, which flips `hostSessionId` to that session. Verified by state broadcast including `seats[n].isHost === true` for the first attacher.
- Reconnect after rematch: socket A disconnects → `requestRematch` fires from socket B → socket A reconnects to the old room → receives `hello` followed by `rematchReady { newRoomId }` with the same id B saw.

### Registry unit tests (new, server suite)

`registry.getRematchRoomId` starts `null`, set-once via `setRematchRoomId`, idempotent on subsequent calls with the same or different `newRoomId` values (last write wins but `setRematchRoomId` is called at most once per source room by the connection handler).

### RoomManager unit tests (new, server suite)

- `createRematchRoom` moves each seated human's `sessionIndex` entry from old roomId → new roomId atomically (verify by calling `sessionRoomId(sessionId)` after creation).
- Finished-room cleanup does not delete `sessionIndex` entries that have been reassigned to a rematch room.
- `createRematchRoom` sets `phase='playing'` and populates `room.game` immediately.

### Deferred

- Board RTL smoke tests — would require heavy prop mocking for low marginal confidence; Playwright MCP screenshots (390×844 mobile, 1280×800 desktop) remain the mandated visual gate per CLAUDE.md.
- End-to-end win → rematch → new-room navigation — Section 8.

### Target counts after Section 6

- Engine: 60 (unchanged).
- Server: ~120 (115 + 5 new rematch tests).
- Main app: ~70 (64 + ~6 adapter tests).

## 6.8 — Out of scope

- Highlighting valid build/discard targets on card selection — UI polish deferred per CLAUDE.md.
- Card-fly animation — deferred.
- Turn transition banner in hot-seat — deferred.
- Scoreboard across games — deferred.
- Real AI strategy — Section 5.
- AWS deploy — Section 7.
- WebSocket-backed end-to-end tests — Section 8.

## References

- `docs/design-session-progress.md` — Sections 1, 2/3, 4 approved and shipped.
- `docs/game-websocket-audit-fixes.md` — the four audit passes whose invariants this Board must preserve.
- `docs/superpowers/specs/2026-04-18-game-websocket-design.md` — Section 3 spec; source of the `PlayerView` / `GameViewSeat` / `GameView` shapes this Board consumes.
- `docs/superpowers/specs/2026-04-17-room-manager-lobby-design.md` — Section 4 spec; source of the `RoomManager.createRoom` contract used by rematch.
