'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { GameAction } from '@/lib/game/types';
import type { ChatEntry, ClientMessage, GameView, ServerMessage } from './protocol';
import { TERMINAL_CLOSE_CODES } from './protocol';

export const MAX_RECONNECT_ATTEMPT = 16;

export function computeReconnectDelay(attempt: number, rand: () => number = Math.random): number {
  const capped = Math.min(attempt, MAX_RECONNECT_ATTEMPT);
  const base = Math.min(10_000, 500 * Math.pow(2, capped));
  const jitter = 0.5 + rand() / 2;
  return Math.round(base * jitter);
}

export function shouldReconnect(code: number): boolean {
  return !TERMINAL_CLOSE_CODES.has(code);
}

export type GameSocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface GameSocket {
  view: GameView | null;
  stateVersion: number;
  status: GameSocketStatus;
  // Transport-level close: populated by ws.onclose, including terminal codes.
  lastError: { code: number; reason: string } | null;
  // Engine-level rejection: populated by server `actionError` messages. Kept
  // separate so UI can distinguish "your move was illegal" from "socket was
  // closed" — they need different handling (retry vs reconnect) and a shared
  // field would bleed an old action error into a later close banner.
  lastActionError: { reason: string } | null;
  sendAction: (action: GameAction) => void;
  sendChat: (text: string) => void;
  chat: ChatEntry[];
}

const OUTBOUND_CAP = 32;
const CHAT_RING_CAP = 50;

export function useGameSocket(roomId: string, sessionId: string): GameSocket {
  const [view, setView] = useState<GameView | null>(null);
  const [stateVersion, setStateVersion] = useState(0);
  const [status, setStatus] = useState<GameSocketStatus>('connecting');
  const [lastError, setLastError] = useState<{ code: number; reason: string } | null>(null);
  const [lastActionError, setLastActionError] = useState<{ reason: string } | null>(null);
  const [chat, setChat] = useState<ChatEntry[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const outboundRef = useRef<ClientMessage[]>([]);
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    // Match the page's protocol. Without this, a Next.js app served over HTTPS
    // that tries to open `ws://` gets blocked as mixed content by every modern
    // browser — the whole networked game would stop working on the production
    // deploy while still working on localhost.
    const base = (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_GAME_WS_URL)
      || (typeof window !== 'undefined'
          ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
          : '');
    const url = `${base}/rooms/${encodeURIComponent(roomId)}/game?sessionId=${encodeURIComponent(sessionId)}`;
    setStatus((prev) => (prev === 'closed' ? prev : (attemptRef.current === 0 ? 'connecting' : 'reconnecting')));
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      attemptRef.current = 0;
      setStatus('open');
      for (const msg of outboundRef.current) ws.send(JSON.stringify(msg));
      outboundRef.current = [];
    };

    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try { msg = JSON.parse(ev.data as string) as ServerMessage; } catch { return; }
      switch (msg.type) {
        case 'hello':
        case 'state':
        case 'gameEnded':
          setView(msg.view);
          setStateVersion(msg.stateVersion);
          break;
        case 'actionError':
          setLastActionError({ reason: msg.reason });
          break;
        case 'chat':
          setChat((prev) => {
            const next = [...prev, { fromSlotIndex: msg.fromSlotIndex, fromName: msg.fromName, text: msg.text, sentAt: msg.sentAt }];
            return next.length > CHAT_RING_CAP ? next.slice(next.length - CHAT_RING_CAP) : next;
          });
          break;
      }
    };

    ws.onclose = (ev) => {
      wsRef.current = null;
      setLastError({ code: ev.code, reason: ev.reason });
      if (!shouldReconnect(ev.code)) { setStatus('closed'); return; }
      const delay = computeReconnectDelay(attemptRef.current);
      attemptRef.current = Math.min(attemptRef.current + 1, MAX_RECONNECT_ATTEMPT);
      setStatus('reconnecting');
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => { /* onclose will follow */ };
  }, [roomId, sessionId]);

  useEffect(() => {
    connect();
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (wsRef.current?.readyState === WebSocket.OPEN) return;
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
      const stale = wsRef.current;
      wsRef.current = null;
      if (stale) {
        stale.onopen = null;
        stale.onmessage = null;
        stale.onclose = null;
        stale.onerror = null;
        try { stale.close(1000); } catch { /* ignore */ }
      }
      attemptRef.current = 0;
      connect();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
        try { ws.close(1000); } catch { /* ignore */ }
      }
      // Flush the outbound queue: messages composed for the old (roomId,
      // sessionId) pair would otherwise replay into the next room and be
      // rejected as `notYourTurn`.
      outboundRef.current = [];
    };
  }, [connect]);

  const enqueue = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(msg)); return; }
    if (outboundRef.current.length >= OUTBOUND_CAP) outboundRef.current.shift();
    outboundRef.current.push(msg);
  }, []);

  const sendAction = useCallback((action: GameAction) => { enqueue({ type: 'action', action }); }, [enqueue]);
  const sendChat = useCallback((text: string) => { enqueue({ type: 'chat', text }); }, [enqueue]);

  return { view, stateVersion, status, lastError, lastActionError, sendAction, sendChat, chat };
}
