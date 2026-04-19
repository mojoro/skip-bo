'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { SeatViewModel } from '@/lib/view/seat';

export interface WinModalAction {
  key: string;
  label: string;
  // 'primary' renders the gold CTA; 'secondary' renders the dark neutral button.
  variant?: 'primary' | 'secondary';
  // Either an internal link (Next.js navigation) or a click handler. If both
  // are set, `href` wins. Both unset produces a disabled button.
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
}

export interface WinModalHeadline {
  title: string;
  subtitle: string | null;
}

export interface WinModalProps {
  open: boolean;
  headline: WinModalHeadline;
  actions: WinModalAction[];
}

export default function WinModal({ open, headline, actions }: WinModalProps) {
  if (!open) return null;
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
            {actions.map((a) => (
              <ActionButton key={a.key} action={a} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionButton({ action }: { action: WinModalAction }): ReactNode {
  const base =
    'px-4 py-2 rounded text-sm disabled:opacity-60 disabled:cursor-not-allowed';
  const variant =
    action.variant === 'primary'
      ? 'bg-[var(--gold)] text-stone-900 font-semibold hover:brightness-110'
      : 'bg-black/40 hover:bg-black/55 border border-white/15 text-white';
  const cls = `${base} ${variant}`;
  if (action.href && !action.disabled) {
    return (
      <Link href={action.href} className={cls}>
        {action.label}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={action.onClick}
      disabled={action.disabled || (!action.onClick && !action.href)}
      className={cls}
    >
      {action.label}
    </button>
  );
}

// Shared headline derivation so /local and /rooms can build identical copy
// without forking the winningTeamIndex + partnership name resolution logic.
export function buildWinHeadline(
  endedReason: 'winner' | 'abandoned' | null,
  winningTeamIndex: number | null,
  partnershipTeams: number[][] | null,
  seats: SeatViewModel[],
): WinModalHeadline {
  if (endedReason === 'abandoned') {
    return { title: 'Game abandoned', subtitle: 'The remaining players have left the game.' };
  }
  // winningTeamIndex should be non-null when endedReason === 'winner';
  // fall through to 'Game over' if the server sends an inconsistent state.
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
