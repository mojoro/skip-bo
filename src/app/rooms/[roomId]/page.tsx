'use client';

import { useEffect, useState, use } from 'react';
import { useGameSocket } from '@/lib/net/useGameSocket';

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

export default function NetworkedRoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = use(params);
  const sessionId = useSessionId();
  const socket = useGameSocket(roomId, sessionId ?? '');

  if (!sessionId) return <main className="p-8">Loading session...</main>;
  if (socket.status === 'closed') {
    return <main className="p-8">Connection closed: {socket.lastError?.reason ?? 'unknown'}.</main>;
  }
  if (!socket.view) return <main className="p-8">Connecting to game...</main>;

  return (
    <main className="p-4 space-y-4">
      <header className="flex gap-4 text-sm">
        <span>room {roomId}</span>
        <span>status {socket.status}</span>
        <span>v{socket.stateVersion}</span>
        <span>turn: slot {socket.view.view.currentPlayerIndex}</span>
      </header>
      <section>
        <h2 className="font-semibold mb-2">Seats</h2>
        <ul className="space-y-1">
          {socket.view.seats.map((s) => (
            <li key={s.slotIndex}>
              #{s.slotIndex} {s.kind} {s.name ?? '-'} {s.connected ? 'online' : 'offline'}
              {s.botControlled ? ' (bot)' : ''}
              {s.graceDeadline ? ` grace-${Math.max(0, Math.round((s.graceDeadline - Date.now()) / 1000))}s` : ''}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
