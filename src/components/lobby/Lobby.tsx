'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { RoomList } from './RoomList';
import { CreateRoomForm } from './CreateRoomForm';
import { JoinByCodeForm } from './JoinByCodeForm';
import { StatsChip } from './StatsChip';
import { DisplayNameEditor } from './DisplayNameEditor';
import { useLobbyStream } from '@/lib/net/useLobbyStream';
import { useMySessionRoom } from '@/lib/net/useMySessionRoom';
import { joinRoom, leaveRoom, ApiError } from '@/lib/net/api';

export interface LobbyProps {
  baseUrl: string;
  sessionId: string;
  displayName: string;
  onDisplayNameChange: (next: string) => void;
}

export function Lobby({ baseUrl, sessionId, displayName, onDisplayNameChange }: LobbyProps) {
  const router = useRouter();
  const { rooms, stats, connected } = useLobbyStream({ baseUrl, sessionId });
  const { roomId: myRoomId, refresh: refreshMyRoom } = useMySessionRoom({ baseUrl, sessionId });
  const [joinError, setJoinError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  const handleJoin = useCallback(async (roomId: string) => {
    setJoinError(null);
    try {
      await joinRoom({ baseUrl, sessionId, roomId, playerName: displayName });
      router.push(`/rooms/${roomId}`);
    } catch (err) {
      setJoinError(err instanceof ApiError ? (err.detail ?? err.title) : String(err));
    }
  }, [baseUrl, sessionId, displayName, router]);

  const handleCreated = (roomId: string) => router.push(`/rooms/${roomId}`);
  const handleJoinedByCode = (roomId: string) => router.push(`/rooms/${roomId}`);

  const handleLeave = async () => {
    if (typeof myRoomId !== 'string') return;
    // Mirror the in-room leave flow: the server may flip the seat to a bot if
    // the game is already playing, so confirm before acting.
    if (!window.confirm('Leave this game? If it has already started, your seat will finish out with a bot.')) return;
    setLeaving(true);
    try {
      await leaveRoom({ baseUrl, sessionId, roomId: myRoomId, targetSessionId: sessionId });
    } catch {
      // Room already deleted, network hiccup, etc. Either way the banner
      // should drop after refresh — fall through.
    }
    refreshMyRoom();
    setLeaving(false);
  };

  const inRoom = typeof myRoomId === 'string';

  return (
    <main
      className="min-h-[100dvh] wood-frame"
      style={{
        paddingTop: 'max(1rem, env(safe-area-inset-top))',
        paddingRight: 'max(1rem, env(safe-area-inset-right))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
        paddingLeft: 'max(1rem, env(safe-area-inset-left))',
      }}
    >
      <div className="felt-surface rounded-xl p-4 sm:p-8 max-w-6xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <h1 className="text-xl sm:text-2xl font-bold tracking-widest text-white">
            SKIP<span className="text-[var(--gold)]">·</span>BO
          </h1>
          <div className="flex items-center gap-3">
            <StatsChip stats={stats} connected={connected} />
            <DisplayNameEditor name={displayName} onChange={onDisplayNameChange} />
          </div>
        </header>

        {inRoom && (
          <div className="mb-6 rounded-xl border border-[var(--gold)]/40 bg-black/40 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-white">You&apos;re in a game</div>
              <div className="text-xs text-white/60">Rejoin your table, or leave it to start a different one.</div>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <button
                type="button"
                onClick={handleLeave}
                disabled={leaving}
                className="border border-white/20 text-white/80 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 rounded text-sm"
              >
                {leaving ? 'Leaving…' : 'Leave game'}
              </button>
              <Link
                href={`/rooms/${myRoomId}`}
                className="bg-[var(--gold)] text-stone-900 font-semibold hover:brightness-110 px-4 py-2 rounded text-sm"
              >
                Resume →
              </Link>
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-[1fr_320px] gap-6">
          <section>
            <h2 className="text-sm uppercase tracking-wider text-white/60 mb-3">Public rooms</h2>
            <RoomList
              rooms={rooms}
              onJoin={handleJoin}
              disabledReason={inRoom ? 'You are already in a game. Leave it to join another.' : null}
            />
            {joinError && <div className="mt-3 text-xs text-rose-300">{joinError}</div>}
          </section>
          <aside className={`space-y-6 ${inRoom ? 'opacity-50 pointer-events-none' : ''}`} aria-disabled={inRoom}>
            <CreateRoomForm baseUrl={baseUrl} sessionId={sessionId} playerName={displayName} onCreated={handleCreated} />
            <JoinByCodeForm baseUrl={baseUrl} sessionId={sessionId} playerName={displayName} onJoined={handleJoinedByCode} />
            <div className="pt-4 border-t border-white/10 text-xs text-white/50">
              <Link href="/local" className="underline decoration-dotted hover:text-white">
                Play hot-seat (local)
              </Link>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
