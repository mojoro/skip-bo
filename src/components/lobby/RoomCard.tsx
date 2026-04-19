'use client';

import type { RoomInfo } from '@/lib/net/protocol';

export interface RoomCardProps {
  room: RoomInfo;
  onJoin: (roomId: string) => void;
}

export function RoomCard({ room, onJoin }: RoomCardProps) {
  const { humans, ai, open, capacity } = room.slotSummary;
  const joinDisabled = open === 0 && !room.allowAiFill;

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-white truncate">{room.displayName}</div>
        <div className="text-xs text-white/60">
          host <span className="text-white/80">{room.hostName}</span> · {humans}/{capacity}
          {ai > 0 && <> +{ai} AI</>} · <span className="uppercase tracking-wider">{room.config.ruleset}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onJoin(room.id)}
        disabled={joinDisabled}
        className="bg-[var(--gold)] text-stone-900 font-semibold hover:brightness-110 px-3 py-1 rounded text-xs disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Join
      </button>
    </div>
  );
}
