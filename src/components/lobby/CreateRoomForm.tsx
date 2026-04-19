'use client';

import { useState } from 'react';
import NewGameModal from '@/components/NewGameModal';
import type { NewGameSettings } from '@/components/NewGameModal';
import { createRoom, ApiError } from '@/lib/net/api';
import type { GameConfig } from '@/lib/game/types';

export interface CreateRoomFormProps {
  baseUrl: string;
  sessionId: string;
  playerName: string;
  onCreated: (roomId: string) => void;
}

export function CreateRoomForm({ baseUrl, sessionId, playerName, onCreated }: CreateRoomFormProps) {
  const [open, setOpen] = useState(false);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [allowAiFill, setAllowAiFill] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleStart = async (settings: NewGameSettings) => {
    setBusy(true);
    setError(null);
    try {
      const partnership = settings.partnershipEnabled
        ? { enabled: true, allowPlayFromPartnerStock: true, allowPlayFromPartnerDiscard: true, allowDiscardToPartnerDiscard: settings.partnershipAllowDiscardToPartner, teams: [] as string[][] }
        : null;
      const config: GameConfig = {
        ruleset: settings.ruleset,
        stockPileSize: settings.stockPileSize,
        handSize: settings.handSize,
        bidirectionalBuild: settings.bidirectionalBuild,
        maxPlayers: settings.playerCount,
        partnership,
      };
      const { roomId } = await createRoom({ baseUrl, sessionId, body: { playerName, config, allowAiFill, visibility } });
      setOpen(false);
      onCreated(roomId);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.title) : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-white/90 uppercase tracking-wider">Create room</h2>
      <div className="flex items-center gap-3 text-xs text-white/70">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={allowAiFill} onChange={e => setAllowAiFill(e.target.checked)} className="rounded" />
          AI fill
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={visibility === 'public'} onChange={e => setVisibility(e.target.checked ? 'public' : 'private')} className="rounded" />
          Public
        </label>
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={busy}
        className="bg-[var(--gold)] text-stone-900 font-semibold hover:brightness-110 px-3 py-1 rounded text-xs disabled:opacity-50"
        aria-label="open settings"
      >
        {busy ? 'Creating…' : 'Create room'}
      </button>
      {error && <div className="text-xs text-rose-300">{error}</div>}
      <NewGameModal open={open} onCancel={() => setOpen(false)} onStart={handleStart} defaultPlayerCount={2} />
    </div>
  );
}
