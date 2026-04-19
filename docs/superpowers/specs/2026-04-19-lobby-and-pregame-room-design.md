# Lobby + pre-game room UI — design

Two browser surfaces sitting on top of the already-shipped server: a lobby at `/` and an AoE2-inspired pre-game room view at `/rooms/[roomId]` during `phase === 'waiting'`. Server changes are narrow — the game WebSocket handshake is relaxed to accept waiting-phase connections so one socket covers both the pre-game and in-game views for a member.

## Goals

- Close the gap between the finished WinModal "Play online" button and actually playing a networked game.
- Give hosts the AoE2 feel: arrange slots (human / AI / open / locked), edit config, chat, hit Start.
- Match the existing wood-frame / felt theme; stay responsive for mobile + desktop.
- Reuse existing server surfaces (`/v1/rooms*`, `/v1/lobby/stream`, game WS chat) with the smallest protocol diff that makes waiting-phase a first-class state.

## Non-goals

- No ready-up flow. Host decides when to start; the client mirrors the server's existing `startGame` preconditions (`humans >= 2 && open === 0`, OR `allowAiFill && humans >= 1 && humans + open >= 2`). Any disagreement between client and server should fail safe — the REST call will reject with `409 tooFew` / `409 openSlots`, and the error handling path surfaces that.
- No account system. Identity is still a `localStorage` sessionId + a new display-name key.
- No custom team colors / civ picker / any AoE2 cosmetic beyond "slot kind swap + team badge when partnership is enabled".
- No mid-game renaming. The display-name editor changes the name used for the next create/join.

## Architecture

### Routes

| Route | Contents |
|---|---|
| `/` | Lobby. Replaces the current minimal landing. Header (wordmark, stats chip, display-name editor). Body: rooms list + "Create room" + "Join by code" forms. Keeps a small "Play hot-seat (local)" link for `/local`. |
| `/rooms/[roomId]` | Phase-branched: `view === null` → `<PreGameRoom>`; `view !== null` → `<Board>` (existing). WinModal rendering unchanged. |

### Server changes (small surface)

- **Handshake relaxation**: `server/src/game/handshake.ts` accepts `phase === 'waiting' || phase === 'playing'` for upgrade. Rejection path for `finished` stays the same non-terminal 4006.
- **Protocol nullability**: `PlayerView.view: PublicPlayerView | null`. `null` during waiting. `GameView` gains `hostSlotIndex: number | null` so clients know who can start without leaking sessionIds. `ServerMessage.hello | state | gameEnded` all carry the widened `GameView`.
- **`broadcastWaitingState(room)` helper** in the game layer: after each REST mutation that affects a waiting room (`setSlot`, `patchRoom`, `addMember`, `removeMember`), fan out a `state` frame to every attached `GameConnection` in the room. The lobby SSE `roomUpdated` emit is unchanged.
- **Chat during waiting**: reuse the existing `ClientMessage.chat` path. The dispatcher already gates on `room.phase === 'playing'` for `action` messages; chat is not gated, just rate-limited.

Start-game stays on REST (`POST /v1/rooms/:id/game`). The game WS stays read-only for room state + write for chat. All mutations route through REST for clean 4xx surfaces.

## Components

### Lobby (`/`)

- **`src/app/page.tsx`** — lobby root. Reads `useDisplayName()` + `useSessionId()`; if display name is absent, renders a centered "Pick a name" gate. Otherwise mounts `<Lobby>`.
- **`src/components/lobby/Lobby.tsx`** — shell. Header: SKIP·BO wordmark, `<StatsChip>`, `<DisplayNameEditor>`. Body: two-column desktop (rooms list left, aside with create + join-by-code forms right), stacked on mobile.
- **`src/components/lobby/RoomList.tsx`** — subscribes to `useLobbyStream()`, renders `<RoomCard>` per public waiting room. Empty-state copy when zero rooms.
- **`src/components/lobby/RoomCard.tsx`** — one row: display name · host name · slot chip (`2/4 humans (+1 AI)`) · ruleset badge · partnership badge (if enabled) · "Join" button. Disabled when `slotSummary.open === 0 && !allowAiFill`. Click → `POST members` → `router.push('/rooms/:id')`.
- **`src/components/lobby/CreateRoomForm.tsx`** — wraps `<NewGameModal>` as the config picker. Adds "Visibility" toggle (public/private) and "Allow AI fill" toggle. Submit → `POST /v1/rooms` → navigate.
- **`src/components/lobby/JoinByCodeForm.tsx`** — code input normalized via a new shared module `src/lib/room/code.ts` (extracted from `server/src/room/code.ts` so both sides apply the same rule). Submits `GET /v1/rooms?code=…` → `POST members` → navigate.
- **`src/components/lobby/StatsChip.tsx`** — reads `useLobbyStream().stats`; renders `N games · M online`. Shows a "reconnecting…" dot when `connected === false`.
- **`src/components/lobby/DisplayNameEditor.tsx`** — popover edit for `skipboDisplayName`. Tooltip: "Your name for the next room".

### Pre-game room (`/rooms/[roomId]` when `view === null`)

- **`src/components/room/PreGameRoom.tsx`** — shell using the existing `wood-frame` + `felt-surface` pattern. Reads `socket.view.seats`, `socket.view.config`, `socket.view.hostSlotIndex`, `socket.chat`, `socket.sendChat`. Panels: `<SlotList>` top, `<ConfigSummary>` middle, `<ChatPanel>` bottom. Host-only action bar with `<StartButton>` + "Edit config". Non-host "Leave" button.
- **`src/components/room/SlotList.tsx`** — N rows (one per capacity). Each row: slot-kind selector (host-only dropdown: Human / AI / Open / Locked — own seat locked; no self-kick), name, team badge (if partnership), host badge, connected dot for human slots. Non-host sees the same list read-only. Mutations fire `PUT /v1/rooms/:id/slots/:index`.
- **`src/components/room/ConfigSummary.tsx`** — read-only key/value list of `config` fields (ruleset, stockPileSize, handSize, bidirectionalBuild, partnership on/off, team shape if on). "Edit" visible to host only → opens `<NewGameModal>` in **edit mode**, which locks `maxPlayers` and (for v1) locks partnership team membership — only `enabled` + the three permission flags are editable. Rationale: changing `maxPlayers` touches follow-up #4 (shrink below seated count); changing team membership invalidates the partnership team shape built at join time. Both land as follow-ups. Submit → `PATCH /v1/rooms/:id`.
- **`src/components/room/ChatPanel.tsx`** — scrolling log of `socket.chat`. Input → `socket.sendChat(text)`. Empty input ignored.
- **`src/components/room/StartButton.tsx`** — host-only gold CTA. Disabled + tooltip when `humans < 2`, or `open > 0 && !allowAiFill`. Click → `POST /v1/rooms/:id/game`.

### Hooks

- **`src/lib/net/useDisplayName.ts`** — mirrors `useSessionId`. localStorage key `skipboDisplayName`. Returns `[name, setName]`. Initial render returns null until post-mount effect.
- **`src/lib/net/useLobbyStream.ts`** — opens `EventSource('/v1/lobby/stream?sessionId=…')`, applies `snapshot | roomAdded | roomUpdated | roomRemoved | statsUpdate` events against a `Map<roomId, RoomInfo>` + stats. Returns `{ rooms, stats, connected }`. Handles `Last-Event-Id` reconnects via native `EventSource` behavior.
- **`src/lib/net/api.ts`** — thin `fetch` wrappers. Bearer session header injected. Problem+JSON parsed into a typed `ApiError { title, status, detail, code? }`. Functions: `createRoom`, `joinRoom`, `leaveRoom`, `setSlot`, `patchRoom`, `startGame`, `findRoomByCode`.

### Touched existing

- `src/lib/net/protocol.ts` — widen `PlayerView.view` to `PublicPlayerView | null`; add `GameView.hostSlotIndex: number | null`. Update the protocol unit tests.
- `src/lib/net/useGameSocket.ts` — already branches on `socket.view`; propagate the widened shape through.
- `src/app/rooms/[roomId]/page.tsx` — phase-branch: `socket.view?.view == null` → `<PreGameRoom>`, else `<Board>`. Action-error toast wrapper stays shared.
- `src/components/NewGameModal.tsx` — add `initial?: NewGameSettings` to prefill and `editMode?: boolean` to disable `playerCount` + partnership team-shape inputs (submit payload excludes those fields when `editMode === true`).
- `server/src/game/handshake.ts` — allow waiting-phase upgrades for a seated session.
- `server/src/game/view.ts` + `buildSeats` — produce `{ view: null, seats, hostSlotIndex }` when `room.game === null`.
- `server/src/game/connection.ts` — `sendHello` + broadcast paths tolerate null game. Chat path unchanged.
- `server/src/room/manager.ts` — after each REST mutation on a waiting room, call `broadcastWaitingState(room)` (new cross-cutting helper wired via the existing registry/subscribers pattern).

## Data flow

### User enters the lobby for the first time

1. `/` mounts → `useSessionId()` reads or creates `skipboSessionId`.
2. `useDisplayName()` checks `skipboDisplayName`. If absent, renders a "Pick a name" gate. Submit writes localStorage, Lobby renders.
3. `useLobbyStream()` opens SSE; `snapshot` hydrates rooms + stats. Subsequent `roomAdded/Updated/Removed/statsUpdate` events mutate the client map.
4. All REST calls use the bearer sessionId for auth; server maps sessionId → seated slot on join.

### Create a public room

1. `CreateRoomForm` submits `{ playerName, displayName, config, allowAiFill, visibility: 'public' }`.
2. Client → `POST /v1/rooms` → `201 { roomId, code }`.
3. Router navigates to `/rooms/:roomId`. Game WS opens under the relaxed handshake. Server sends `hello` with `view: null`, full `seats`, `config`, `hostSlotIndex`.
4. `PreGameRoom` renders. Lobby subscribers see a `roomAdded` event; the room appears in their list.

### Join by code

1. `JoinByCodeForm` submits the code → `GET /v1/rooms?code=…` → `{ rooms: [RoomInfo] }`.
2. If match, `POST /v1/rooms/:id/members` with `playerName` → `201 { slotIndex }`.
3. Navigate to `/rooms/:id`. Game WS opens. Server `broadcastWaitingState` fires so existing members see the new joiner.

### Host edits a slot

1. Host selects "AI" in a slot dropdown → `PUT /v1/rooms/:id/slots/:index { kind: 'ai', difficulty: 'easy' }`.
2. `RoomManager.setSlot` applies → `emitRoomUpdated` (lobby SSE) + `broadcastWaitingState` (game WS to room members).
3. Every `PreGameRoom` in the room re-renders with new seats; lobby cards re-render with new `slotSummary`.

### Host edits config

1. Host clicks "Edit config" → `<NewGameModal>` opens prefilled from `socket.view.config`.
2. Submit → `PATCH /v1/rooms/:id` (merge-patch+JSON). Server `patchRoom` handler applies; same two broadcasts fire.

### Chat while waiting

1. User submits text → `useGameSocket.sendChat(text)` enqueues `{ type: 'chat', text }` over the already-open WS.
2. Server's existing chat dispatcher sanitizes, rate-limits, and broadcasts `{ type: 'chat', fromSlotIndex, fromName, text, sentAt }` to every attached socket.
3. Every `PreGameRoom` renders the new message.

### Host starts the game

1. `StartButton` → `POST /v1/rooms/:id/game`.
2. Server flips `room.phase = 'playing'`, initializes `room.game`, fires `emitRoomRemoved` (room vanishes from lobby) + `broadcastWaitingState`. With `room.game !== null`, the broadcast's `view` is now populated.
3. Every connected client's `socket.view.view` flips from null to populated → `/rooms/[roomId]` phase-branches to `<Board>`.

### Leave a waiting room

1. "Leave" → `DELETE /v1/rooms/:id/members/:sessionId`.
2. Server clears the slot (open), `broadcastWaitingState`, lobby `roomUpdated`.
3. Client navigates back to `/`. `useGameSocket` effect cleanup closes the WS.
4. If the leaver was host, `RoomManager.migrateHost` promotes the next seated human (already implemented in `removeMember`).

## Error handling

- **Lobby SSE dropout** — `EventSource` auto-reconnects with `Last-Event-Id`. Server's `replaySince` replays buffered events or sends a fresh snapshot. `useLobbyStream.connected` toggles; StatsChip shows a reconnecting dot.
- **REST failures** — `api.ts` parses `application/problem+json` into `{ title, status, detail }`. Forms show `detail` inline under the submit button. Specific cases:
  - `422` → surface field errors, keep form state.
  - `409 sessionAlreadySeated` → offer a "Rejoin existing room" link using the room id from the problem detail.
  - `409 full` on join → "Room is full"; SSE `roomUpdated` should correct the stale list shortly.
  - `404 notFound` on join-by-code → "No room with that code".
  - `403 kicked` → "You've been kicked from this room"; Join button stays disabled with a tooltip.
- **WS handshake rejects on `/rooms/[roomId]`** — existing `<Closed>` banner covers terminal codes (unchanged). Non-terminal 4006 for `finished` triggers normal reconnect.
- **Slot mutation during network flap** — UI is fully controlled by `socket.view.seats`; if the REST `PUT` fails (403/409), the dropdown snaps back on the next broadcast and a toast surfaces the reason. No optimistic UI.
- **Chat rate-limit** — server silently drops; client sees the message not appear. Accepted for v1. Follow-up: server could emit `actionError` on drop.
- **Display-name edit while seated** — localStorage change doesn't propagate. Editor tooltip makes this explicit: "Your name for the next room".
- **REST after eviction** — `403 kicked` disables the Join button on that card; the lobby card is still rendered because the room is still public.

## Testing

### Unit — hooks

- `useDisplayName.test.ts` — persists/reads localStorage, initial render null until effect, `setName` writes through.
- `useLobbyStream.test.ts` — mock `EventSource` emitting full event sequence (`snapshot → roomAdded → roomUpdated → roomRemoved → statsUpdate`); assert client room map converges. Cover reconnect path.

### Unit — API layer

- `api.test.ts` — stub `fetch`; assert Bearer header injection, 2xx happy paths for each function, Problem+JSON parsing into typed errors for 4xx/5xx.

### Unit — components (React Testing Library)

- `RoomCard.test.tsx` — renders slot chip, host name, ruleset badge; "Join" disabled when `open === 0 && !allowAiFill`.
- `CreateRoomForm.test.tsx` — submit wiring, public/private toggle payloads, server error surfacing.
- `JoinByCodeForm.test.tsx` — normalizes input, 404 surface.
- `SlotList.test.tsx` — host sees dropdowns, non-host read-only, own seat dropdown disabled, team badges render when partnership set.
- `ChatPanel.test.tsx` — renders messages, submit calls `sendChat`, empty input ignored.

### Integration — client

- `lobby-flow.test.tsx` — mock SSE + fetch, mount `<Lobby>`, verify snapshot populates list, `roomAdded` appends, click "Join" fires navigate spy.
- `pregame-flow.test.tsx` — mock WS (pattern from existing `useGameSocket.test.ts`); verify PreGameRoom renders slots + chat + start button; host clicks Start → POST fired; subsequent `state` with populated `view` flips to `<Board>`.

### Server — new / modified

- `handshake.test.ts` — extend existing coverage with waiting-phase accept + still-rejected finished-without-rematch.
- `waitingBroadcast.test.ts` — `setSlot` / `patchRoom` / `addMember` / `removeMember` each produce a `state` frame with `view: null` + updated `seats` to every attached socket.
- `view.test.ts` — `buildGameView` with `room.game === null` returns `{ view: null, seats, hostSlotIndex, config }`.
- `connection.test.ts` — chat still works when `room.game === null`.

### Browser verification

Playwright at 1280×800 and 390×844: lobby populates, create room navigates, pre-game room renders slots + chat, host slot-kind dropdown updates a second browser tab's view, start-game transitions both tabs into `<Board>`. Verify once end-to-end before claiming done.

### Test count projection

- Root suite: +~30 tests (hooks + API + components + two integration files).
- Server suite: +~10 tests (handshake/waitingBroadcast/view/connection).

## Open follow-ups (not blocking)

- Follow-up #4 (`patchRoomSchema` allows `maxPlayers` shrink below seated count) — client works around it by locking `maxPlayers` in edit mode. Proper fix is a config-aware PATCH handler on the server.
- Partnership team-shape editing in the room view — deferred. v1 only exposes the `enabled` + three permission flags.
- Stale-old-URL-after-rematch redirect (previously noted in Section 6 audit) — when lobby exists, a card redirect can replace the "terminal close" UX.
- Server `actionError` on chat rate-limit drop for clearer feedback.
