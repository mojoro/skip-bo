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
import { joinRoom, ApiError } from '@/lib/net/api';

export interface LobbyProps {
  baseUrl: string;
  sessionId: string;
  displayName: string;
  onDisplayNameChange: (next: string) => void;
}

export function Lobby({ baseUrl, sessionId, displayName, onDisplayNameChange }: LobbyProps) {
  const router = useRouter();
  const { rooms, stats, connected } = useLobbyStream({ baseUrl, sessionId });
  const [joinError, setJoinError] = useState<string | null>(null);

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

  return (
    <main className="min-h-screen wood-frame p-4 sm:p-6">
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

        <div className="grid md:grid-cols-[1fr_320px] gap-6">
          <section>
            <h2 className="text-sm uppercase tracking-wider text-white/60 mb-3">Public rooms</h2>
            <RoomList rooms={rooms} onJoin={handleJoin} />
            {joinError && <div className="mt-3 text-xs text-rose-300">{joinError}</div>}
          </section>
          <aside className="space-y-6">
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
