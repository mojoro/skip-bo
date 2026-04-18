# Skip-Bo

Browser multiplayer Skip-Bo card game. Part of John Moorman "10 projects 10 weeks" sprint; learning goals: real-time networking, from-scratch drag-drop, AWS deploy. **Build from scratch — no frameworks that abstract learning target.**

Repo: https://github.com/mojoro/skip-bo

## 🔖 Where we left off

Section 4 (Room Manager & Lobby) designed, specced, implemented as `server/` — REST, SSE, in-memory RoomManager, pm2 + Docker. Section 3 (game WebSocket) integration points stubbed (close codes, grace window) pending own plan. Next: brainstorm Section 3 or Section 5 (AI bots). Run `cd server && npm test` for full suite. Pick up via `docs/design-session-progress.md`.

**Follow-ups (deferred from Tasks 1–24 review):**
1. `setSlot` orphans sessionIndex on human→locked or human→ai displacement (cleanup guard too narrow — only `desired.kind === 'open'`).
2. Double `roomRemoved` emit: `finishGame` → cleanup timer → `deleteRoom` both emit. Gate `emitRoomRemoved` on `this.rooms.has(room.id)`.
3. `finishGame` should defensively `clearIdleTimer(room)` for invariant hygiene.
4. `patchRoomSchema` allows partial `config` merges that silently resize below seated count — drop `config` from PATCH or add config-aware handler.
5. `RoomManager.addMember` / `buildInitialSlots` seat humans `connected: false` — intentional (means WS-attached). Flag in WS section when Section 3 done.
6. DELETE `/v1/rooms/:id/members/:sessionId` returns 204 when target session not seated (no-op); consider 404 for clearer signal.
7. Slot handler validation order: Zod body parse before integer-index guard, so request with malformed body + non-integer index returns `validation` problem type instead of `badIndex` (both 422 — cosmetic mismatch).
8. Branch coverage thin on slot + game handlers: no explicit 401 / 404 / 409 (phase) tests at handler level.
9. Module-level rate limiters in `server.ts` shared across tests within process; adding 2nd `Bearer s1` POST `/v1/rooms` test can flake. Export `resetLimiters()` helper for tests.
10. Root `.dockerignore` missing — `docker compose build` at context `..` sends entire repo (`node_modules`, `.next`, `.git`) to Docker daemon. Add before first real image build.
11. Full-flow integration test reads raw SSE chunks with `.includes(...)` rather than accumulating `\n\n`-delimited event buffer — works today, fragile if server coalesces writes; `reader.cancel()` + `httpServer.close()` not awaited at teardown.
12. Plan text for ring-buffer `since(lastId)` at ~line 2810 still has `-1` fixed in code — plan markdown last inconsistency.
13. Root `tsconfig.json` picks up `server/` TS files but lacks `@engine/*` alias (lives in `server/tsconfig.json`). Either exclude `server/` from root tsconfig or teach it alias.

**State:** server suite 69/69 pass, main-app suite 60/60 pass, typecheck clean.

## Status snapshot

- **Engine (done):** pure TypeScript module under `src/lib/game/`. Deterministic mulberry32 shuffle, ruleset enum (recommended / official), partnership mode with 3 permission flags. 60 Vitest tests covering deck composition, createGame defaults, PLAY_TO_BUILD across sources/directions, DISCARD + turn advance, win condition singles + partnerships, PlayerView visibility.
- **UI (done, single-player hot-seat):** desktop tabletop layout (green felt + wood frame, seats around table) for 2-4 players; compact stacked layout (opponents scroll above, active zone pinned bottom) on mobile always + desktop when 5+ players. Mattel card palette. Responsive via Tailwind `md` breakpoint + runtime player-count check.
- **Drag and drop (done):** custom stack under `src/lib/dnd/` — no library. Pointer Events with movement threshold, imperative transform on floating ghost, rect-based hit-test, Escape cancels. `DragDropProvider` / `useDraggable` / `useDroppable`.
- **Modals (done):** `NewGameModal`, `RulesetInfo`, `ConfirmDialog` (end-turn confirm), `WildDirectionPicker` (inline asc/desc choice, replaces `window.confirm`).
- **Networking — Room Manager + Lobby (done):** `server/` package with REST (rooms/members/slots/game), SSE lobby stream with snapshot+deltas+heartbeat, in-memory `RoomManager` (idle + post-game cleanup, host migration), Zod schemas, Problem+JSON errors, token-bucket rate limits, graceful shutdown, esbuild+pm2+Dockerfile. 69 Vitest tests including full-flow integration test. OpenAPI 3.1 spec at `server/openapi.yaml`.
- **Networking — game WebSocket + client hook (not started):** Section 3 design approved; integration stubs (close codes, 60s grace window, 1001 broadcast on shutdown) already in `server/` ready for WS layer.

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

### 1. Game WebSocket — Section 3 (the real needle-mover)

Section 4 lobby shipped but game still hot-seat only. Section 3 = actual network play. **Not yet brainstormed/specced/planned.** Start with `superpowers:brainstorming` on the spec at `docs/design-session-progress.md` Section 3 (already rewritten with protocol detail — use as anchor, not blank page).

Design is already locked on these points (spec Section 3, in `docs/design-session-progress.md`):
- Raw `ws` library, no Socket.IO.
- HTTP Upgrade handshake on `/game?roomId=…&sessionId=…`. Origin check (CSWSH). Validate sessionId against `RoomManager.sessionRoomId`. Duplicate-session kick with close code 4004.
- Protocol-level heartbeat: `ws.ping()` + `pong` event, NOT app-level JSON PING.
- Close codes: 1000 normal, 1001 shutdown, 1008 policy, 1009 msg too big, 4001 room full, 4002 kicked, 4003 invalid session, 4004 duplicate, 4005 game ended.
- Backpressure cap via `ws.bufferedAmount`. `maxPayload` ~16 KB. Per-connection token bucket.
- 60s disconnect grace: seat held, then bot sub or game-end.
- State version number on every broadcast for client reconciliation.

Existing integration points (already in `server/`) that the WS layer consumes:
- `Slot.connected: boolean` — WS layer flips `true` on connect, `false` on disconnect.
- `RoomManager.events.on('*')` — lobby SSE already subscribes; WS should publish slot/phase changes through the same bus.
- `installShutdown({ registry, httpServer })` in `server/src/shutdown.ts` has stub comment for 1001 broadcast.
- Engine `applyAction(state, action)` is the single dispatch contract — server validates then broadcasts `{stateVersion, state}`.

Client side: replace the local `useState` dispatch in `src/app/page.tsx` with a `useGameSocket(sessionId, roomId)` hook. `sessionId` in localStorage (UUID v4). Exp backoff + jitter reconnect. Close-code-aware retry policy.

**Brainstorm questions to surface before planning:**
- Single `/game` endpoint for all rooms (mux by query) vs per-room path?
- Server-authoritative action validation — replay entire `applyAction` or light pre-check?
- State broadcast: full snapshot per action vs diff? (Skip-Bo state is tiny — full snapshot simpler.)
- Bot substitution at grace timeout: new `Slot.kind: 'ai'` replacement or `human` stays but `connected:false` and server plays for them?
- Test strategy for raw `ws` — real socket pairs vs mock `WebSocket`?

### 2. AI bots (Section 5 — not drafted)
Server-side, rule-based. Same `applyAction` contract as humans. Artificial turn delay for natural feel. Brainstorm after Section 3. Half the work, ships solo play.

### 3. AWS deployment (Section 7 — not drafted)
EC2 + Docker (image already builds) + nginx reverse proxy (Upgrade header must be explicitly forwarded — classic WS gotcha). Let's Encrypt SSL. CI/CD via GitHub Actions or manual deploy script.

### 4. UI polish (deferred by user)
Useful but not ship gates:
- Highlight valid build/discard targets when card selected or dragged.
- Win modal with Play Again CTA (current: just ribbon).
- Card-fly animation on play.
- Turn transition banner between hot-seat handoffs.
- Scoreboard across games.

## Locked design references

- `docs/design-session-progress.md` — brainstorming progress. Sections 1 (engine), 2/3 (WS protocol), 4 (Room Manager) **approved + Section 4 shipped**. Section 3 rewritten with deeper protocol detail — anchor for the WS brainstorm. Sections 5 (AI), 6 (Frontend), 7 (AWS), 8 (Testing) **not drafted**.
- `docs/superpowers/specs/2026-04-17-room-manager-lobby-design.md` — Section 4 spec (shipped). Reference for style when writing Section 3 spec.
- `docs/superpowers/plans/2026-04-17-room-manager-lobby.md` — Section 4 plan (executed Tasks 1-24). Reference for task granularity when writing Section 3 plan.
- `~/Documents/John-Brain/WebSocket-networking-deep-dive.md` — personal notes on stack from TCP up through WS, byte-level detail on Upgrade handshake + protocol-level framing.

## Conventions

- **Commits:** single-line subject, imperative completing "This commit will…", no body, no Co-Authored-By, no Conventional-Commits prefixes. If change won't fit 75 chars, split further. `git log --oneline` should read as build tutorial.
- **Atomic commits:** one logical change per commit. Commit as you go, not at end.
- **Build from scratch:** DnD was `@dnd-kit/react`, ripped out — hand-rolling is the point. Same for WebSocket: stick with raw `ws`.
- **Verify UI in-browser:** Playwright MCP screenshot at 390×844 (mobile) + 1280×800 (desktop) when change affects layout. Typecheck + tests not enough for visual claims.
- **Use context7 MCP for library docs** instead of guessing from training data.
- **Hot-seat first, networking later:** every engine action routes through `applyAction(state, action)`, same contract server will speak. Client dispatch swaps `useState` → `sendOverWS` with minimal change.

## Known constraints

- No auth / accounts (by design for v1 — sessionId sufficient).
- No persistence — all state in-memory on server (when built), no DB.
- No AI yet — solo play hot-seat only.
- No network play yet — Section 3 (game WS) not implemented. Lobby works but game dispatches local only.
- `demo-snapshot` branch preserved locally (pre-rebase state), not pushed.