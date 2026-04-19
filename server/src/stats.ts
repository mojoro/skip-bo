import type { RoomManager } from './room/manager';
import type { LobbyStreamRegistry } from './sse/registry';

// Publishes a `statsUpdate` event whenever the numbers change. Polls every
// 2 s so lobby viewers see updates promptly without a per-event fan-out
// hook. `playersOnline` is the union of:
//   * Humans currently WS-attached to a room (seen via RoomManager).
//   * Sessions subscribed to the lobby SSE stream (seen via registry).
// Deduped by sessionId so a player who is both browsing the lobby and
// seated in a room counts once.
export function startStatsTicker(mgr: RoomManager, registry: LobbyStreamRegistry): () => void {
  const compute = () => {
    const ids = new Set<string>(mgr.seatedSessionIds());
    for (const id of registry.sessionIds()) ids.add(id);
    return { gamesInProgress: mgr.gamesInProgress(), playersOnline: ids.size };
  };
  let lastStats = JSON.stringify(compute());
  const interval = setInterval(() => {
    const next = JSON.stringify(compute());
    if (next !== lastStats) {
      lastStats = next;
      registry.publish({ type: 'statsUpdate', stats: JSON.parse(next) });
    }
  }, 2_000);
  return () => clearInterval(interval);
}
