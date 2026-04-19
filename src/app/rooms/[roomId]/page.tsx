'use client';

import { useEffect, useMemo, useState, use, type ReactNode, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useGameSocket } from '@/lib/net/useGameSocket';
import Board from '@/components/Board';
import type { WinModalAction } from '@/components/WinModal';

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
  const router = useRouter();

  // Auto-dismiss lastActionError after 2 s
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => {
    if (!socket.lastActionError) return;
    setActionError(socket.lastActionError.reason);
    const id = setTimeout(() => setActionError(null), 2000);
    return () => clearTimeout(id);
  }, [socket.lastActionError]);

  // Pending state for the rematch button so clicking it flips to "Creating…"
  // immediately instead of waiting for the rematchReady round trip. Cleared
  // once the server delivers a rematchRoomId.
  const [rematchPending, setRematchPending] = useState(false);
  useEffect(() => {
    if (socket.rematchRoomId) setRematchPending(false);
  }, [socket.rematchRoomId]);

  const onBackToLobby = useCallback(() => router.push('/'), [router]);
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

  // view is null when the room is still in waiting phase (no game started yet).
  // Task 22 will replace this placeholder with the PreGameRoom component.
  if (!view) {
    return (
      <Frame>
        <Placeholder>Waiting for the game to start…</Placeholder>
      </Frame>
    );
  }

  return (
    <>
      {/* Action error toast — overlays the board */}
      {actionError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg text-sm text-rose-200 bg-rose-900/90 ring-1 ring-rose-700/60 shadow-lg pointer-events-none">
          <strong className="font-semibold">Action rejected:</strong> {actionError}
        </div>
      )}

      <Board
        view={view}
        seats={seats}
        dispatch={socket.sendAction}
        youSlotIndex={view.youSlotIndex}
        winActions={winActions}
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
