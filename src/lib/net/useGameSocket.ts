'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { GameAction } from '@/lib/game/types';
import type { ChatEntry, ClientMessage, GameView, ServerMessage } from './protocol';
import { TERMINAL_CLOSE_CODES } from './protocol';

export function computeReconnectDelay(attempt: number, rand: () => number = Math.random): number {
  const base = Math.min(10_000, 500 * Math.pow(2, attempt));
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
  lastError: { code: number; reason: string } | null;
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
  const [chat, setChat] = useState<ChatEntry[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const outboundRef = useRef<ClientMessage[]>([]);
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    const base = (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_GAME_WS_URL)
      || (typeof window !== 'undefined' ? `ws://${window.location.host}` : '');
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
          setLastError({ code: 0, reason: msg.reason });
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
      attemptRef.current += 1;
      setStatus('reconnecting');
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => { /* onclose will follow */ };
  }, [roomId, sessionId]);

  useEffect(() => {
    connect();
    const onVisible = () => {
      if (document.visibilityState === 'visible' && wsRef.current?.readyState !== WebSocket.OPEN) {
        if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
        attemptRef.current = 0;
        connect();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) { try { ws.close(1000); } catch { /* ignore */ } }
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

  return { view, stateVersion, status, lastError, sendAction, sendChat, chat };
}
