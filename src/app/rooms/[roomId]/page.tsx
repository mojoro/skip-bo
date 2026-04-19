'use client';

import { useEffect, useMemo, useState, use, type ReactNode, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useGameSocket } from '@/lib/net/useGameSocket';
import ActionErrorToast from '@/components/ActionErrorToast';
import Board from '@/components/Board';
import { PreGameRoom } from '@/components/room/PreGameRoom';
import type { WinModalAction } from '@/components/WinModal';
import { leaveRoom } from '@/lib/net/api';
import { gameApiBaseUrl } from '@/lib/net/endpoints';
import { randomUUID } from '@/lib/net/uuid';

function useSessionId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    let existing = localStorage.getItem('skipboSessionId');
    if (!existing) {
      existing = randomUUID();
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
  const router = useRouter();


  // Pending state for the rematch button so clicking it flips to "Creating…"
  // immediately instead of waiting for the rematchReady round trip. Cleared
  // once the server delivers a rematchRoomId.
  const [rematchPending, setRematchPending] = useState(false);
  useEffect(() => {
    if (socket.rematchRoomId) setRematchPending(false);
  }, [socket.rematchRoomId]);

  const onBackToLobby = useCallback(() => router.push('/'), [router]);

  // 4003 = "invalid session" / "no slot" — the server doesn't know this user
  // for this room. Happens most often when a stale roomId is reopened after
  // the room was cleaned up. Kick back to the lobby instead of stranding the
  // user on a dead-end panel they can only escape via the browser chrome.
  useEffect(() => {
    if (socket.status === 'closed' && socket.lastError?.code === 4003) {
      router.replace('/');
    }
  }, [socket.status, socket.lastError?.code, router]);
  const onRequestRematch = useCallback(() => {
    if (socket.rematchRoomId || rematchPending) return;
    setRematchPending(true);
    socket.requestRematch();
  }, [socket, rematchPending]);

  const winActions: WinModalAction[] = useMemo(() => {
    const back: WinModalAction = {
      key: 'lobby',
      label: 'Back to lobby',
      onClick: onBackToLobby,
    };
    if (socket.rematchRoomId) {
      return [
        back,
        {
          key: 'rematchLink',
          label: 'Enter rematch →',
          variant: 'primary',
          href: `/rooms/${socket.rematchRoomId}`,
        },
      ];
    }
    return [
      back,
      {
        key: 'rematch',
        label: rematchPending ? 'Creating rematch…' : 'Keep same group',
        variant: 'primary',
        onClick: onRequestRematch,
        disabled: rematchPending,
      },
    ];
  }, [socket.rematchRoomId, rematchPending, onBackToLobby, onRequestRematch]);

  if (!sessionId) return <Frame><Placeholder>Waiting for session id…</Placeholder></Frame>;

  if (socket.status === 'closed') {
    return (
      <Frame>
        <Closed code={socket.lastError?.code} reason={socket.lastError?.reason} />
      </Frame>
    );
  }

  if (!socket.view) {
    return (
      <Frame>
        <Placeholder>
          {socket.status === 'reconnecting' ? 'Reconnecting…' : 'Opening game socket…'}
        </Placeholder>
      </Frame>
    );
  }

  const { view, seats } = socket.view;

  const baseUrl = gameApiBaseUrl();

  const handleLeaveGame = async () => {
    // Confirm before forfeiting — the server flips the seat to bot-controlled
    // and the game continues without the user. Also ends the game outright if
    // no other live humans remain.
    if (!window.confirm('Leave this game? Your seat will finish out with a bot.')) return;
    try {
      await leaveRoom({ baseUrl, sessionId, roomId, targetSessionId: sessionId });
    } catch { /* navigate anyway — socket close + lobby refetch will converge */ }
    router.push('/');
  };

  if (!view) {
    return (
      <PreGameRoom
        baseUrl={baseUrl}
        sessionId={sessionId ?? ''}
        roomId={roomId}
        seats={socket.view.seats}
        config={socket.view.config}
        hostSlotIndex={socket.view.hostSlotIndex}
        youSlotIndex={socket.view.youSlotIndex}
        chat={socket.chat}
        onSendChat={socket.sendChat}
        allowAiFill={socket.view.allowAiFill}
        code={socket.view.code}
      />
    );
  }

  return (
    <>
      <ActionErrorToast error={socket.lastActionError} />

      <Board
        view={view}
        seats={seats}
        dispatch={socket.sendAction}
        youSlotIndex={view.youSlotIndex}
        winActions={winActions}
        chat={socket.chat}
        onSendChat={socket.sendChat}
        headerAction={
          view.phase === 'playing' ? (
            <button
              type="button"
              onClick={handleLeaveGame}
              className="bg-black/40 hover:bg-black/55 border border-white/15 px-2 sm:px-3 py-1 rounded text-[11px] sm:text-xs text-white/90 whitespace-nowrap"
            >
              Leave game
            </button>
          ) : null
        }
      />
    </>
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
