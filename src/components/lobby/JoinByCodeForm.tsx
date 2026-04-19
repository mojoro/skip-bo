'use client';

import { useState } from 'react';
import { findRoomByCode, joinRoom, ApiError } from '@/lib/net/api';
import { normalizeRoomCode } from '@/lib/room/code';

export interface JoinByCodeFormProps {
  baseUrl: string;
  sessionId: string;
  playerName: string;
  onJoined: (roomId: string) => void;
}

export function JoinByCodeForm({ baseUrl, sessionId, playerName, onJoined }: JoinByCodeFormProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeRoomCode(code);
    if (!normalized) return;
    setBusy(true);
    setError(null);
    try {
      const room = await findRoomByCode({ baseUrl, code: normalized });
      if (!room) { setError('No room with that code'); return; }
      await joinRoom({ baseUrl, sessionId, roomId: room.id, playerName });
      onJoined(room.id);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.title) : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <h2 className="text-sm font-semibold text-white/90 uppercase tracking-wider">Join by code</h2>
      <label className="block text-xs text-white/70">
        Code
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="mt-1 block w-full bg-black/40 border border-white/15 rounded px-2 py-1 text-sm text-white"
        />
      </label>
      <button type="submit" disabled={busy}
        className="bg-[var(--gold)] text-stone-900 font-semibold hover:brightness-110 px-3 py-1 rounded text-xs disabled:opacity-50">
        {busy ? 'Joining…' : 'Join'}
      </button>
      {error && <div className="text-xs text-rose-300">{error}</div>}
    </form>
  );
}
