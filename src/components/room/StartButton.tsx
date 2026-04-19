'use client';

import type { RoomInfo } from '@/lib/net/protocol';

type SlotSummary = RoomInfo['slotSummary'];

export function canStart(summary: SlotSummary, allowAiFill: boolean): boolean {
  const { humans, open } = summary;
  if (humans >= 2 && open === 0) return true;
  if (allowAiFill && humans >= 1 && humans + open >= 2) return true;
  return false;
}

export interface StartButtonProps {
  slotSummary: SlotSummary;
  allowAiFill: boolean;
  busy: boolean;
  onClick: () => void;
}

export function StartButton({ slotSummary, allowAiFill, busy, onClick }: StartButtonProps) {
  const enabled = canStart(slotSummary, allowAiFill) && !busy;
  const tooltip = enabled
    ? 'Start the game'
    : slotSummary.humans < 2 && !allowAiFill
      ? 'Need at least two human players'
      : slotSummary.open > 0
        ? 'Fill or lock open slots first'
        : 'Not enough players';
  return (
    <button type="button" onClick={onClick} disabled={!enabled} title={tooltip}
      className="bg-[var(--gold)] text-stone-900 font-semibold hover:brightness-110 px-4 py-2 rounded text-sm disabled:opacity-60 disabled:cursor-not-allowed">
      {busy ? 'Starting…' : 'Start game'}
    </button>
  );
}
