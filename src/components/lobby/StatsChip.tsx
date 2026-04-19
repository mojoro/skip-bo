'use client';

import type { LobbyStats } from '@/lib/net/useLobbyStream';

export interface StatsChipProps {
  stats: LobbyStats;
  connected: boolean;
}

export function StatsChip({ stats, connected }: StatsChipProps) {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-xs text-white/80"
      style={{ background: 'rgba(0,0,0,0.45)' }}
    >
      {!connected && (
        <span
          aria-label="reconnecting"
          className="w-2 h-2 rounded-full bg-amber-300 animate-pulse"
        />
      )}
      <span>{stats.gamesInProgress} games · {stats.playersOnline} online</span>
    </div>
  );
}
