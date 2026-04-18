import type { RoomManager } from './room/manager';
import type { LobbyStreamRegistry } from './sse/registry';

export function startStatsTicker(mgr: RoomManager, registry: LobbyStreamRegistry): () => void {
  let lastStats = JSON.stringify(mgr.stats());
  const interval = setInterval(() => {
    const next = JSON.stringify(mgr.stats());
    if (next !== lastStats) {
      lastStats = next;
      registry.publish({ type: 'statsUpdate', stats: JSON.parse(next) });
    }
  }, 2_000);
  return () => clearInterval(interval);
}
