'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import NewGameModal from '@/components/NewGameModal';
import type { NewGameSettings } from '@/components/NewGameModal';
import { SlotList } from './SlotList';
import { ConfigSummary } from './ConfigSummary';
import { ChatPanel } from './ChatPanel';
import { StartButton } from './StartButton';
import { leaveRoom, patchRoom, setSlot, startGame, ApiError } from '@/lib/net/api';
import type { GameViewSeat, ChatEntry, PublicGameConfig } from '@/lib/net/protocol';

export interface PreGameRoomProps {
  baseUrl: string;
  sessionId: string;
  roomId: string;
  seats: GameViewSeat[];
  config: PublicGameConfig;
  hostSlotIndex: number | null;
  youSlotIndex: number;
  chat: ChatEntry[];
  onSendChat: (text: string) => void;
  allowAiFill: boolean;
}

export function PreGameRoom(props: PreGameRoomProps) {
  const router = useRouter();
  const isHost = props.youSlotIndex === props.hostSlotIndex;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slotSummary = summarize(props.seats);

  const handleSetSlot = async (index: number, desired: { kind: 'open' | 'locked' } | { kind: 'ai'; difficulty: 'easy' }) => {
    setError(null);
    try {
      await setSlot({ baseUrl: props.baseUrl, sessionId: props.sessionId, roomId: props.roomId, index, desired });
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.title) : String(err));
    }
  };

  const handleStart = async () => {
    setBusy(true);
    setError(null);
    try {
      await startGame({ baseUrl: props.baseUrl, sessionId: props.sessionId, roomId: props.roomId });
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.title) : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleLeave = async () => {
    try {
      await leaveRoom({ baseUrl: props.baseUrl, sessionId: props.sessionId, roomId: props.roomId, targetSessionId: props.sessionId });
    } catch { /* ignore */ }
    router.push('/');
  };

  const handleEditSave = async (settings: NewGameSettings) => {
    setError(null);
    try {
      // `partnership` is intentionally omitted. Teams on the wire use
      // slot indices (number[][]), but the server stores engine player
      // ids (string[][]) and rebuilds teams at startGame from the final
      // slot order anyway. Sending the publicized shape would corrupt
      // the stored string[][] or fail Zod — neither helps. Partnership
      // toggles mid-waiting are a separate follow-up.
      await patchRoom({
        baseUrl: props.baseUrl, sessionId: props.sessionId, roomId: props.roomId,
        patch: {
          config: {
            ruleset: settings.ruleset,
            stockPileSize: settings.stockPileSize,
            handSize: settings.handSize,
            bidirectionalBuild: settings.bidirectionalBuild,
          },
        },
      });
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.title) : String(err));
    }
  };

  const initialSettings: NewGameSettings = {
    playerCount: props.config.maxPlayers,
    ruleset: props.config.ruleset,
    stockPileSize: props.config.stockPileSize,
    handSize: props.config.handSize,
    bidirectionalBuild: props.config.bidirectionalBuild,
    partnershipEnabled: !!props.config.partnership?.enabled,
    partnershipAllowDiscardToPartner: props.config.partnership?.allowDiscardToPartnerDiscard ?? false,
  };

  return (
    <main className="min-h-screen wood-frame p-4 sm:p-6">
      <div className="felt-surface rounded-xl p-4 sm:p-8 max-w-3xl mx-auto space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-lg sm:text-xl font-bold tracking-widest text-white">WAITING ROOM</h1>
          <button type="button" onClick={handleLeave}
            className="text-xs text-white/60 hover:text-white underline decoration-dotted">
            Leave room
          </button>
        </header>

        <section>
          <h2 className="text-xs uppercase tracking-wider text-white/70 font-semibold mb-2">Players</h2>
          <SlotList seats={props.seats} youSlotIndex={props.youSlotIndex} isHost={isHost} onSetSlot={handleSetSlot} />
        </section>

        <ConfigSummary config={props.config} isHost={isHost} onEdit={() => setEditing(true)} />
        <ChatPanel chat={props.chat} onSend={props.onSendChat} />

        {isHost && (
          <div className="flex justify-end">
            <StartButton slotSummary={slotSummary} allowAiFill={props.allowAiFill} busy={busy} onClick={handleStart} />
          </div>
        )}

        {error && <div className="text-xs text-rose-300">{error}</div>}
      </div>

      <NewGameModal
        open={editing}
        onCancel={() => setEditing(false)}
        onStart={handleEditSave}
        defaultPlayerCount={props.config.maxPlayers}
        initial={initialSettings}
        editMode
      />
    </main>
  );
}

function summarize(seats: GameViewSeat[]): { humans: number; ai: number; open: number; locked: number; capacity: number } {
  const s = { humans: 0, ai: 0, open: 0, locked: 0, capacity: seats.length };
  for (const seat of seats) {
    if (seat.kind === 'human') s.humans++;
    else if (seat.kind === 'ai') s.ai++;
    else if (seat.kind === 'open') s.open++;
    else s.locked++;
  }
  return s;
}
