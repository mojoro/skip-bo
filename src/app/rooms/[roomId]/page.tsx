'use client';

import { useEffect, useState, use, type ReactNode } from 'react';
import { useGameSocket } from '@/lib/net/useGameSocket';
import type { GameViewSeat } from '@/lib/net/protocol';

function useSessionId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    let existing = localStorage.getItem('skipboSessionId');
    if (!existing) {
      existing = crypto.randomUUID();
      localStorage.setItem('skipboSessionId', existing);
    }
    setId(existing);
  }, []);
  return id;
}

function useNow(intervalMs = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
  connecting: { label: 'Connecting', cls: 'bg-amber-500/15 text-amber-200 ring-amber-500/40' },
  reconnecting: { label: 'Reconnecting', cls: 'bg-amber-500/15 text-amber-200 ring-amber-500/40' },
  open: { label: 'Live', cls: 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/40' },
  closed: { label: 'Closed', cls: 'bg-rose-500/15 text-rose-200 ring-rose-500/40' },
};

export default function NetworkedRoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params);
  const sessionId = useSessionId();
  const socket = useGameSocket(roomId, sessionId ?? '');
  const now = useNow();

  if (!sessionId) return <Frame><Placeholder>Waiting for session id…</Placeholder></Frame>;
  if (socket.status === 'closed') {
    return (
      <Frame>
        <Closed code={socket.lastError?.code} reason={socket.lastError?.reason} />
      </Frame>
    );
  }
  if (!socket.view) return <Frame><Placeholder>Opening game socket…</Placeholder></Frame>;

  const { view, seats } = socket.view;
  const status = STATUS_STYLES[socket.status] ?? STATUS_STYLES.closed!;

  return (
    <Frame>
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-amber-200/60">Skip-Bo · room</p>
          <h1 className="font-mono text-lg sm:text-xl text-amber-100 select-text break-all">{roomId}</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Chip className={status.cls}>
            <Dot className="bg-current" />
            {status.label}
          </Chip>
          <Chip className="bg-white/5 text-white/60 ring-white/10 font-mono">v{socket.stateVersion}</Chip>
        </div>
      </header>

      {socket.lastActionError && (
        <div className="mt-4 text-xs text-rose-200 bg-rose-900/30 ring-1 ring-rose-800/60 rounded px-3 py-2">
          <strong className="font-semibold">Action rejected:</strong> {socket.lastActionError.reason}
        </div>
      )}

      <div className="mt-6 flex items-center gap-2 text-xs text-white/55">
        <span>Turn</span>
        <span className="font-mono text-amber-200/80">slot {view.currentPlayerSlotIndex}</span>
        <span className="text-white/25">·</span>
        <span className="capitalize">{view.phase} phase</span>
      </div>

      <section className="mt-3">
        <h2 className="text-[11px] uppercase tracking-[0.18em] text-white/40 mb-2">Seats</h2>
        <ul className="space-y-2">
          {seats.map((s) => (
            <SeatRow
              key={s.slotIndex}
              seat={s}
              now={now}
              isYou={s.slotIndex === view.youSlotIndex}
              isCurrent={s.slotIndex === view.currentPlayerSlotIndex}
            />
          ))}
        </ul>
      </section>

      <footer className="mt-8 pt-4 border-t border-white/5 text-[11px] text-white/35 font-mono select-text">
        session {sessionId.slice(0, 8)}…
      </footer>
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen felt-surface flex items-start justify-center p-4 sm:p-10 overflow-auto">
      <div className="w-full max-w-2xl wood-frame rounded-xl p-6 sm:p-8 table-inset">
        <div className="bg-black/30 rounded-lg p-5 sm:p-6 ring-1 ring-white/5">
          {children}
        </div>
      </div>
    </main>
  );
}

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-white/55">
      <span className="w-2 h-2 rounded-full bg-amber-300/60 animate-pulse" />
      <span className="italic">{children}</span>
    </div>
  );
}

function Closed({ code, reason }: { code?: number; reason?: string }) {
  return (
    <div className="space-y-3">
      <h1 className="text-xl text-rose-200 font-semibold">Disconnected</h1>
      <div className="text-sm text-white/70">
        <span className="font-mono text-rose-200/80">close {code ?? '?'}</span>
        {reason ? <span className="ml-2 text-white/50">— {reason}</span> : null}
      </div>
      <p className="text-xs text-white/45">This close code is terminal; reload the page to try again.</p>
    </div>
  );
}

function SeatRow({
  seat,
  now,
  isYou,
  isCurrent,
}: {
  seat: GameViewSeat;
  now: number;
  isYou: boolean;
  isCurrent: boolean;
}) {
  const graceLeft = seat.graceDeadline ? Math.max(0, Math.ceil((seat.graceDeadline - now) / 1000)) : null;
  const presence = presenceFor(seat, graceLeft);

  return (
    <li
      className={[
        'flex items-center gap-3 px-3 py-2 rounded-md ring-1 transition-colors',
        'bg-black/25',
        isCurrent ? 'ring-amber-400/50 bg-amber-950/20' : 'ring-white/5',
      ].join(' ')}
    >
      <span className="font-mono text-white/40 text-xs w-7 tabular-nums">#{seat.slotIndex}</span>
      <span className="text-white/95 font-medium truncate">
        {seat.name ?? <em className="text-white/35 font-normal">empty</em>}
      </span>
      {seat.isHost && <Chip className="bg-yellow-500/15 text-yellow-100 ring-yellow-500/40">host</Chip>}
      {isYou && <Chip className="bg-sky-500/15 text-sky-200 ring-sky-500/40">you</Chip>}
      {isCurrent && <Chip className="bg-amber-500/15 text-amber-200 ring-amber-500/40">turn</Chip>}
      <span className="ml-auto flex items-center gap-1.5">
        <Chip className="bg-white/5 text-white/55 ring-white/10 capitalize">{seat.kind}</Chip>
        <Chip className={presence.cls}>{presence.label}</Chip>
      </span>
    </li>
  );
}

function Chip({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 px-2 py-0.5 text-[10.5px] font-medium rounded-full ring-1 whitespace-nowrap',
        className,
      ].join(' ')}
    >
      {children}
    </span>
  );
}

function Dot({ className = '' }: { className?: string }) {
  return <span className={['w-1.5 h-1.5 rounded-full', className].join(' ')} />;
}

function presenceFor(seat: GameViewSeat, graceLeft: number | null): { label: string; cls: string } {
  if (seat.kind === 'ai') return { label: 'bot', cls: 'bg-violet-500/15 text-violet-200 ring-violet-500/40' };
  if (seat.kind === 'locked') return { label: 'locked', cls: 'bg-white/5 text-white/45 ring-white/10' };
  if (seat.kind === 'open') return { label: 'open', cls: 'bg-white/5 text-white/45 ring-white/10' };
  if (seat.botControlled) return { label: 'bot control', cls: 'bg-violet-500/15 text-violet-200 ring-violet-500/40' };
  if (graceLeft !== null) return { label: `grace ${graceLeft}s`, cls: 'bg-amber-500/15 text-amber-200 ring-amber-500/40' };
  if (seat.connected) return { label: 'online', cls: 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/40' };
  return { label: 'offline', cls: 'bg-white/5 text-white/50 ring-white/10' };
}
