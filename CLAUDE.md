@AGENTS.md

# Skip-Bo

Browser-based multiplayer Skip-Bo card game. Part of John Moorman's "10 projects in 10 weeks" portfolio sprint; learning goals are real-time networking, from-scratch drag-and-drop, and AWS deployment. **Build things from scratch — don't reach for frameworks that abstract away the learning target.**

Repo: https://github.com/mojoro/skip-bo

## 🔖 Where we left off

Room Manager & Lobby implementation (Tasks 1-24 in `docs/superpowers/plans/2026-04-17-room-manager-lobby.md`) is **mid-flight** on branch `room-manager-lobby`. Running under `superpowers:subagent-driven-development` with parallelized subagent dispatch.

**Done (Tasks 1-12, 16, 22):** server package bootstrapped; shared types; room code generator; slot helpers; typed event bus; full RoomManager (create/get/list/join/leave/setSlot/startGame/finishGame + idle+post-game timers + host migration); Problem+JSON helper; HTTP server + router + 6 middleware; Zod schemas; rooms handlers (POST/GET/PATCH); SSE registry + ring buffer; OpenAPI 3.1 yaml. Plus two scaffold-fix commits: engine `noUncheckedIndexedAccess` hardening (`bb18f98`) and HTTP+SSE defensive hardening (`06272b6`, covers `res.headersSent` guard, `req.destroy()` on oversize body, router literal-escape, SSE double-close guard, subscribers snapshot in publish, ring-buffer future-id guard).

**State:** server suite 57/57 passing, main-app suite 60/60 passing, typecheck clean.

**Still TODO (Tasks 13, 14, 15, 17, 18, 19, 20, 21, 23, 24):**
- Task 13 — Members handlers (POST/DELETE /v1/rooms/:id/members[:sessionId])
- Task 14 — Slots handler (PUT /v1/rooms/:id/slots/:index)
- Task 15 — Game handler (POST /v1/rooms/:id/game)
- Task 17 — Lobby SSE stream handler (mount `GET /v1/lobby/stream` using the registry + snapshot + heartbeat + Last-Event-ID replay)
- Task 18 — Throttled statsUpdate ticker
- Task 19 — Rate-limit middleware wiring into POST /v1/rooms and member-join
- Task 20 — Graceful shutdown + entrypoint `src/index.ts`
- Task 21 — Dockerfile, pm2, compose, esbuild
- Task 23 — Full-flow integration test
- Task 24 — Close-the-loop doc/status updates (update this section; note deferred plan issues below)

**Deferred plan issues for Task 24 to surface (caught during reviews):**
1. `setSlot` orphan sessionIndex bug — human→locked or human→ai displacement doesn't clean up sessionIndex or kickedSessionIds. Plan source at line ~1077; fix: broaden the cleanup guard to any human displacement, not only `desired.kind === 'open'`.
2. Double `roomRemoved` emission in `finishGame` → cleanup timer → `deleteRoom` both emit. Latent; fix by gating `emitRoomRemoved` on `this.rooms.has(room.id)`.
3. `finishGame` should defensively `clearIdleTimer(room)` even though `startGame` already does — invariant fragility.
4. `patchRoomSchema` allows `config` partial merges that could silently resize below seated count — recommend either dropping `config` from PATCH or adding a config-aware handler in a follow-up.
5. Ring-buffer `since(lastId)` plan text at line ~2810 needs the `-1` removed so it matches the test (already fixed in code; plan text is the last inconsistency).
6. `RoomManager.addMember` / `buildInitialSlots` now seat humans as `connected: false` — intentional: `connected` means WS-attached, the future WS layer flips it true on connect. Flag this in the WS section.

**To resume:** run the next `superpowers:subagent-driven-development` wave — Tasks 13/14/15 are file-disjoint and can parallelize (each adds a handler + test + a single-line mount entry). Task 17 depends on Task 16 (done) and Task 10 (done) — can go in parallel with 13/14/15. Task 18 needs 16. Task 19 needs 10. Task 20 needs everything. Task 21 + 23 + 24 last. Read each task's "Files" list in the plan before dispatching to confirm what's disjoint.

## Status snapshot

- **Engine (done):** pure TypeScript module under `src/lib/game/`. Deterministic mulberry32 shuffle, ruleset enum (recommended / official), partnership mode with 3 permission flags. 60 Vitest tests covering deck composition, createGame defaults, PLAY_TO_BUILD across sources and directions, DISCARD + turn advance, win condition for singles and partnerships, PlayerView visibility.
- **UI (done, single-player hot-seat):** desktop tabletop layout (green felt + wood frame, seats around the table) for 2-4 players; compact stacked layout (opponents scroll above, active zone pinned bottom) on mobile always and desktop when 5+ players. Mattel-style card palette. Responsive via Tailwind `md` breakpoint + runtime player-count check.
- **Drag and drop (done):** custom stack under `src/lib/dnd/` — no library. Pointer Events with movement threshold, imperative transform on a floating ghost, rect-based hit-test, Escape cancels. `DragDropProvider` / `useDraggable` / `useDroppable`.
- **Modals (done):** `NewGameModal`, `RulesetInfo`, `ConfirmDialog` (end-turn confirm), `WildDirectionPicker` (inline asc/desc choice, replaces a `window.confirm`).
- **Networking (not started):** design locked in `docs/design-session-progress.md`. Server, client WS hook, lobby, rooms — all still to build.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript strict · Tailwind 4 · Vitest · no DnD library, no WS library yet.

## Commands

```
npm run dev        # Next.js dev server
npm test           # vitest run (60 tests)
npm run test:watch # watch mode
npm run lint       # ESLint
npx tsc --noEmit   # typecheck
```

## Layout

```
src/
├── app/
│   ├── page.tsx            # Home + Board inner component
│   ├── layout.tsx
│   └── globals.css         # tabletop theme, felt/wood, card-back pattern
├── components/
│   ├── Card.tsx            # presentational, Mattel palette
│   ├── DraggableCard.tsx   # wraps Card with useDraggable
│   ├── DroppableZone.tsx   # wraps children with useDroppable
│   ├── DragGhost.tsx       # floating card following the pointer
│   ├── Seat.tsx            # desktop tabletop seat (absolute-positioned)
│   ├── TableCenter.tsx     # desktop draw/build/completed piles
│   ├── MobileBoard.tsx     # compact stacked layout
│   ├── MobileOpponentStrip.tsx
│   ├── WildDirectionPicker.tsx
│   ├── NewGameModal.tsx
│   ├── RulesetInfo.tsx
│   └── ConfirmDialog.tsx
├── lib/
│   ├── game/               # pure engine + tests
│   │   ├── types.ts
│   │   ├── rng.ts          # mulberry32
│   │   ├── deck.ts         # 162-card Skip-Bo deck
│   │   ├── engine.ts       # createGame, applyAction, getPlayerView
│   │   ├── testHelpers.ts
│   │   └── *.test.ts
│   ├── dnd/                # custom drag and drop
│   │   ├── context.tsx     # DragDropProvider, pointer listeners, ghost transform, hit-test
│   │   ├── hooks.ts        # useDraggable (pointerdown + threshold), useDroppable (registry)
│   │   └── types.ts        # DragSourceData, DropTargetData
│   └── layout/
│       └── seating.ts      # desktop seat presets for 2..8
└── docs/
    ├── design-session-progress.md   # networking design brief, locked sections
    └── superpowers/specs/           # brainstorming specs (if added)
```

## What's next (prioritized)

### 1. Networking — the main learning goal
- **Node.js game server** (not started). Raw `ws` library, no Socket.IO.
  - HTTP Upgrade handshake: Origin check (CSWSH prevention), session query-param validation, duplicate-session kick (close code 4004).
  - Protocol-level ping heartbeat (`ws.ping()` / `pong` event) — NOT app-level JSON PING.
  - Close codes: 1000 normal, 1001 shutdown, 1008 policy violation, 1009 msg too big, 4001 room full, 4002 kicked, 4003 invalid session, 4004 duplicate, 4005 game ended.
  - Backpressure cap via `ws.bufferedAmount`.
  - Per-connection token-bucket rate limit.
  - `maxPayload` set (~16 KB).
  - Server holds disconnected player's seat for 60s, then substitutes bot or ends game.
  - State version number on every broadcast.
- **Client WS hook** replacing the current local `useState` dispatch in `src/app/page.tsx`.
  - `sessionId` in localStorage (UUID v4).
  - Exponential backoff + jitter reconnect.
  - Close-code-aware retry policy.
- **Room manager + lobby** (Section 4 of the design doc — **not yet drafted**). Need a brainstorm pass before coding.
  - HTTP endpoints: create / list / join.
  - Public lobby feed + private 6-char room codes.
  - Room lifecycle (create → fill → playing → finished → cleanup).

### 2. AI bots (design Section 5 — not drafted)
Server-side, rule-based. Same `GameAction` interface as humans. Artificial turn delay so it feels natural.

### 3. AWS deployment (design Section 7 — not drafted)
EC2 + Docker + nginx reverse proxy (Upgrade header must be explicitly forwarded — classic WS gotcha). Let's Encrypt SSL. CI/CD via GitHub Actions or manual deploy script.

### 4. UI polish (deferred by user)
All useful but not shipping gates:
- Highlight valid build/discard targets when a card is selected or dragged.
- Win modal with Play Again CTA (current: just a ribbon).
- Card-fly animation on play.
- Turn transition banner between hot-seat handoffs.
- Scoreboard across games.

## Locked design references

- `docs/design-session-progress.md` — brainstorming progress. Sections 1 (engine state machine), 2 (WebSocket protocol), 3 (architecture) **approved**. Section 3 (WebSocket protocol) was rewritten with deeper detail — see the networking list above. Sections 4 (Room Manager), 5 (AI), 6 (Frontend), 7 (AWS), 8 (Testing) **not yet drafted**.
- `~/Documents/John-Brain/WebSocket-networking-deep-dive.md` — personal notes on the stack from TCP up through WS, with byte-level detail on the Upgrade handshake and protocol-level framing.

## Conventions

- **Commits:** single-line subject, imperative completing "This commit will…", no body, no Co-Authored-By, no Conventional-Commits prefixes. If a change can't fit in 75 chars, split it further. `git log --oneline` should read as a build tutorial.
- **Atomic commits:** one logical change per commit. Commit as you go, not at the end.
- **Build from scratch:** DnD was originally `@dnd-kit/react` but we ripped it out because hand-rolling is the point. Same will apply when choosing a WebSocket approach — we stick with raw `ws`.
- **Verify UI in-browser:** use the Playwright MCP to screenshot at 390×844 (mobile) and 1280×800 (desktop) when the change affects layout. Typecheck + tests aren't enough for visual claims.
- **Use context7 MCP for library docs** instead of guessing from training data.
- **Hot-seat first, networking later:** every engine action already routes through `applyAction(state, action)`, which is the same contract the server will speak. The client's dispatch can be swapped from `useState` to `sendOverWS` with minimal change.

## Known constraints

- No auth / accounts (by design for v1 — sessionId is sufficient).
- No persistence — all state in-memory on server (when built), no DB.
- No AI yet — solo play is hot-seat only.
- `demo-snapshot` branch preserved locally (pre-rebase state), not pushed.
