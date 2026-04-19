'use client';

import { useEffect, useState } from 'react';
import type { RoomInfo } from './protocol';

export interface LobbyStats {
  gamesInProgress: number;
  playersOnline: number;
}

export interface UseLobbyStreamArgs {
  baseUrl: string;
  sessionId: string | null;
}

export interface LobbyStream {
  rooms: RoomInfo[];
  stats: LobbyStats;
  connected: boolean;
}

export function useLobbyStream(args: UseLobbyStreamArgs): LobbyStream {
  const [rooms, setRooms] = useState<Map<string, RoomInfo>>(new Map());
  const [stats, setStats] = useState<LobbyStats>({ gamesInProgress: 0, playersOnline: 0 });
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!args.sessionId) return;
    const url = `${args.baseUrl}/v1/lobby/stream?sessionId=${encodeURIComponent(args.sessionId)}`;
    const es = new EventSource(url);

    const onSnapshot = (ev: MessageEvent) => {
      const data = JSON.parse(ev.data) as { type: 'snapshot'; rooms: RoomInfo[]; stats: LobbyStats };
      setRooms(new Map(data.rooms.map((r) => [r.id, r])));
      setStats(data.stats);
    };
    const onAdded = (ev: MessageEvent) => {
      const data = JSON.parse(ev.data) as { type: 'roomAdded'; room: RoomInfo };
      setRooms((prev) => new Map(prev).set(data.room.id, data.room));
    };
    const onUpdated = (ev: MessageEvent) => {
      const data = JSON.parse(ev.data) as { type: 'roomUpdated'; room: RoomInfo };
      setRooms((prev) => new Map(prev).set(data.room.id, data.room));
    };
    const onRemoved = (ev: MessageEvent) => {
      const data = JSON.parse(ev.data) as { type: 'roomRemoved'; roomId: string };
      setRooms((prev) => { const next = new Map(prev); next.delete(data.roomId); return next; });
    };
    const onStats = (ev: MessageEvent) => {
      const data = JSON.parse(ev.data) as { type: 'statsUpdate'; stats: LobbyStats };
      setStats(data.stats);
    };

    es.addEventListener('snapshot', onSnapshot);
    es.addEventListener('roomAdded', onAdded);
    es.addEventListener('roomUpdated', onUpdated);
    es.addEventListener('roomRemoved', onRemoved);
    es.addEventListener('statsUpdate', onStats);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    return () => {
      es.removeEventListener('snapshot', onSnapshot);
      es.removeEventListener('roomAdded', onAdded);
      es.removeEventListener('roomUpdated', onUpdated);
      es.removeEventListener('roomRemoved', onRemoved);
      es.removeEventListener('statsUpdate', onStats);
      es.close();
    };
  }, [args.baseUrl, args.sessionId]);

  return {
    rooms: [...rooms.values()].sort((a, b) => b.createdAt - a.createdAt),
    stats,
    connected,
  };
}
