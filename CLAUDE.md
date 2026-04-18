@AGENTS.md

# Skip-Bo

Browser-based multiplayer Skip-Bo card game. Part of John Moorman's "10 projects in 10 weeks" portfolio sprint; learning goals are real-time networking, from-scratch drag-and-drop, and AWS deployment. **Build things from scratch — don't reach for frameworks that abstract away the learning target.**

Repo: https://github.com/mojoro/skip-bo

## 🔖 Where we left off

Section 4 (Room Manager & Lobby) is designed, specced, and implemented as the `server/` package — REST, SSE, in-memory RoomManager, pm2 + Docker. Section 3 (game WebSocket) integration points are stubbed (close codes, grace window) pending its own plan. Next up: brainstorm Section 3 or Section 5 (AI bots). Run `cd server && npm test` to exercise the full suite. Pick up via `docs/design-session-progress.md`.

**Follow-ups (deferred from the Tasks 1–24 review cycle):**
1. `setSlot` orphan sessionIndex on human→locked or human→ai displacement (cleanup guard is too narrow — currently only `desired.kind === 'open'`).
2. Double `roomRemoved` emission: `finishGame` → cleanup timer → `deleteRoom` both emit. Gate `emitRoomRemoved` on `this.rooms.has(room.id)`.
3. `finishGame` should defensively `clearIdleTimer(room)` for invariant hygiene.
4. `patchRoomSchema` allows partial `config` merges that could silently resize below seated count — drop `config` from PATCH or add a config-aware handler.
5. `RoomManager.addMember` / `buildInitialSlots` seat humans as `connected: false` — intentional (means WS-attached). Flag in the WS section when Section 3 is implemented.
6. DELETE `/v1/rooms/:id/members/:sessionId` returns 204 when the target session isn't seated (no-op); consider returning 404 for clearer client signal.
7. Slot handler validation order: Zod body parse runs before the integer-index guard, so a request with both malformed body and non-integer index returns the `validation` problem type instead of `badIndex` (both are 422 — cosmetic problem-type mismatch).
8. Branch coverage thin on slot + game handlers: no explicit 401 / 404 / 409 (phase) tests at the handler level.
9. Module-level rate limiters in `server.ts` are shared across tests within a process; adding a 2nd `Bearer s1` POST `/v1/rooms` test can flake. Consider exporting a `resetLimiters()` helper for tests.
10. Root-level `.dockerignore` is missing — `docker compose build` at context `..` will send the entire repo (`node_modules`, `.next`, `.git`) to the Docker daemon. Add a root `.dockerignore` before first real image build.
11. Full-flow integration test reads raw SSE chunks with `.includes(...)` rather than accumulating a `\n\n`-delimited event buffer — works today, fragile if the server ever coalesces writes; `reader.cancel()` + `httpServer.close()` also aren't awaited at teardown.
12. Plan text for ring-buffer `since(lastId)` at ~line 2810 still has the `-1` that was fixed in code — the plan markdown is the last inconsistency.

**State:** server suite 69/69 passing, main-app suite 60/60 passing, typecheck clean.

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
