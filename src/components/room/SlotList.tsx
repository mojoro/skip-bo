'use client';

import type { GameViewSeat } from '@/lib/net/protocol';

type SlotDesired = { kind: 'open' | 'locked' } | { kind: 'ai'; difficulty: 'easy' };

export interface SlotListProps {
  seats: GameViewSeat[];
  youSlotIndex: number;
  isHost: boolean;
  onSetSlot: (index: number, desired: SlotDesired) => void;
}

export function SlotList({ seats, youSlotIndex, isHost, onSetSlot }: SlotListProps) {
  return (
    <ul className="space-y-2">
      {seats.map((seat) => {
        const canEdit = isHost && seat.slotIndex !== youSlotIndex;
        return (
          <li key={seat.slotIndex} className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2">
            <span className="text-[10px] uppercase tracking-widest text-white/50 w-8">#{seat.slotIndex + 1}</span>
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <span className="text-sm text-white truncate">{labelFor(seat)}</span>
              {seat.isHost && <span className="text-[10px] uppercase tracking-wider text-[var(--gold)] font-bold">host</span>}
              {seat.kind === 'human' && <ConnectionDot connected={seat.connected} graceDeadline={seat.graceDeadline} botControlled={seat.botControlled} />}
            </div>
            {canEdit && (
              <select
                className="bg-black/40 border border-white/15 rounded px-2 py-1 text-xs text-white"
                value={seat.kind}
                onChange={(e) => {
                  const v = e.target.value as 'open' | 'locked' | 'ai';
                  onSetSlot(seat.slotIndex, v === 'ai' ? { kind: 'ai', difficulty: 'easy' } : { kind: v });
                }}
              >
                <option value="human" disabled>Human (joined)</option>
                <option value="open">Open</option>
                <option value="locked">Locked</option>
                <option value="ai">AI</option>
              </select>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function labelFor(seat: GameViewSeat): string {
  if (seat.kind === 'human') return seat.name ?? 'Player';
  if (seat.kind === 'ai') return 'AI';
  if (seat.kind === 'locked') return 'Locked';
  return 'Empty';
}

function ConnectionDot({ connected, graceDeadline, botControlled }: { connected: boolean; graceDeadline: number | null; botControlled: boolean }) {
  if (botControlled) return <span className="text-[10px] text-orange-300">bot takeover</span>;
  if (!connected && graceDeadline !== null) return <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" aria-label="disconnected, grace running" />;
  if (!connected) return <span className="w-2 h-2 rounded-full bg-rose-500" aria-label="disconnected" />;
  return <span className="w-2 h-2 rounded-full bg-emerald-400" aria-label="connected" />;
}
