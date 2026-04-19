'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { SeatViewModel } from '@/lib/view/seat';

export interface WinModalProps {
  open: boolean;
  phase: 'playing' | 'finished' | 'waiting';
  endedReason: 'winner' | 'abandoned' | null;
  winningTeamIndex: number | null;
  partnershipTeams: number[][] | null;
  seats: SeatViewModel[];
  rematchRoomId: string | null;
  onRequestRematch: () => void;
  onBackToLobby: () => void;
}

export default function WinModal(props: WinModalProps) {
  const {
    open, phase, endedReason, winningTeamIndex, partnershipTeams, seats,
    rematchRoomId, onRequestRematch, onBackToLobby,
  } = props;
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (!open) setRequested(false);
  }, [open]);

  useEffect(() => {
    if (rematchRoomId) setRequested(false);
  }, [rematchRoomId]);

  if (!open || phase !== 'finished') return null;

  const headline = buildHeadline(endedReason, winningTeamIndex, partnershipTeams, seats);

  const rematchLabel = rematchRoomId
    ? 'Enter rematch →'
    : requested
      ? 'Creating rematch…'
      : 'Keep same group';

  const rematchDisabled = requested && !rematchRoomId;

  const handleRematchClick = () => {
    if (rematchRoomId) return;
    setRequested(true);
    onRequestRematch();
  };

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Game finished"
    >
      <div className="wood-frame rounded-2xl p-4 sm:p-5 max-w-md w-full">
        <div className="bg-black/30 rounded-xl p-6 ring-1 ring-white/10 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-widest text-[var(--gold)] mb-3">
            {headline.title}
          </h2>
          {headline.subtitle && (
            <p className="text-sm text-white/80 mb-6">{headline.subtitle}</p>
          )}

          <div className="mt-4 flex flex-col sm:flex-row gap-2 sm:gap-3 justify-center">
            <button
              type="button"
              onClick={onBackToLobby}
              className="bg-black/40 hover:bg-black/55 border border-white/15 px-4 py-2 rounded text-white text-sm"
            >
              Back to lobby
            </button>
            {rematchRoomId ? (
              <Link
                href={`/rooms/${rematchRoomId}`}
                className="bg-[var(--gold)] text-stone-900 font-semibold hover:brightness-110 px-4 py-2 rounded text-sm"
              >
                {rematchLabel}
              </Link>
            ) : (
              <button
                type="button"
                onClick={handleRematchClick}
                disabled={rematchDisabled}
                className="bg-[var(--gold)] text-stone-900 font-semibold hover:brightness-110 px-4 py-2 rounded text-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {rematchLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface Headline {
  title: string;
  subtitle: string | null;
}

function buildHeadline(
  endedReason: WinModalProps['endedReason'],
  winningTeamIndex: number | null,
  partnershipTeams: number[][] | null,
  seats: SeatViewModel[],
): Headline {
  if (endedReason === 'abandoned') {
    return { title: 'Game abandoned', subtitle: 'The remaining players have left the game.' };
  }
  if (winningTeamIndex === null) {
    return { title: 'Game over', subtitle: null };
  }
  if (partnershipTeams && partnershipTeams.length > 0) {
    const teamMembers = (partnershipTeams[winningTeamIndex] ?? []).map((slot) => {
      const seat = seats.find((s) => s.slotIndex === slot);
      return seat?.name ?? `Slot ${slot}`;
    });
    return {
      title: `TEAM ${winningTeamIndex + 1} WINS`,
      subtitle: teamMembers.join(' & '),
    };
  }
  const winner = seats.find((s) => s.slotIndex === winningTeamIndex);
  const name = winner?.name ?? `Slot ${winningTeamIndex}`;
  return { title: `${name.toUpperCase()} WINS`, subtitle: null };
}
