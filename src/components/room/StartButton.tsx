'use client';

import type { RoomInfo } from '@/lib/net/protocol';

type SlotSummary = RoomInfo['slotSummary'];

// Mirrors `RoomManager.startGame` preconditions. Rules:
//   * At least one human must be seated — an all-AI room has no owner.
//   * Playable seat count ≥ 2 where playable = humans + AI + open. The
//     server fills any remaining open seats with AI at start time, so a
//     solo host clicking Start produces a valid human-vs-AI game.
//
// `allowAiFill` is kept in the signature for API stability but is no
// longer consulted — the server treats open slots as auto-AI at start.
export function canStart(summary: SlotSummary, _allowAiFill: boolean): boolean {
  const { humans, ai, open } = summary;
  if (humans < 1) return false;
  if (humans + ai + open < 2) return false;
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
  const tooltip = enabled
    ? open > 0 ? 'Start the game (open seats will be filled with AI)' : 'Start the game'
    : humans < 1
      ? 'At least one human must be seated'
      : humans + ai + open < 2
        ? 'Need at least two seats playable (human, AI, or open)'
        : 'Not enough players';
  return (
    <button type="button" onClick={onClick} disabled={!enabled} title={tooltip}
      className="bg-[var(--gold)] text-stone-900 font-semibold hover:brightness-110 px-4 py-2 rounded text-sm disabled:opacity-60 disabled:cursor-not-allowed">
      {busy ? 'Starting…' : 'Start game'}
    </button>
  );
}
