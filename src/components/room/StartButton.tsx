'use client';

import type { RoomInfo } from '@/lib/net/protocol';

type SlotSummary = RoomInfo['slotSummary'];

// Mirrors `RoomManager.startGame` preconditions. Rules:
//   * At least one human must be seated — an all-AI room has no owner.
//   * Playable seat count ≥ 2 where playable = humans + explicitly placed
//     AI slots + (open slots only if allowAiFill will convert them at start).
//   * Remaining open slots block the start when allowAiFill is off: the
//     host must either toggle them to AI, lock them, enable AI fill, or
//     wait for more players.
export function canStart(summary: SlotSummary, allowAiFill: boolean): boolean {
  const { humans, ai, open } = summary;
  if (humans < 1) return false;
  const playable = humans + ai + (allowAiFill ? open : 0);
  if (playable < 2) return false;
  if (open > 0 && !allowAiFill) return false;
  return true;
}

export interface StartButtonProps {
  slotSummary: SlotSummary;
  allowAiFill: boolean;
  busy: boolean;
  onClick: () => void;
}

export function StartButton({ slotSummary, allowAiFill, busy, onClick }: StartButtonProps) {
  const enabled = canStart(slotSummary, allowAiFill) && !busy;
  const { humans, ai, open } = slotSummary;
  const playable = humans + ai + (allowAiFill ? open : 0);
  const tooltip = enabled
    ? 'Start the game'
    : humans < 1
      ? 'At least one human must be seated'
      : open > 0 && !allowAiFill
        ? 'Toggle open slots to AI, lock them, or enable AI fill'
        : playable < 2
          ? 'Need at least two players'
          : 'Not enough players';
  return (
    <button type="button" onClick={onClick} disabled={!enabled} title={tooltip}
      className="bg-[var(--gold)] text-stone-900 font-semibold hover:brightness-110 px-4 py-2 rounded text-sm disabled:opacity-60 disabled:cursor-not-allowed">
      {busy ? 'Starting…' : 'Start game'}
    </button>
  );
}
