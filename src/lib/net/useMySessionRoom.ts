'use client';

import { useCallback, useEffect, useState } from 'react';
import { getMyRoom } from './api';

export interface UseMySessionRoomArgs {
  baseUrl: string;
  sessionId: string | null;
}

export interface MySessionRoom {
  // The server-authoritative answer to "where is this session seated right now?".
  // `null` means the session is unseated and free to create/join. `undefined`
  // means the answer hasn't come back yet — callers should render a neutral
  // state rather than assume either.
  roomId: string | null | undefined;
  refresh: () => void;
}

export function useMySessionRoom(args: UseMySessionRoomArgs): MySessionRoom {
  const [roomId, setRoomId] = useState<string | null | undefined>(undefined);
  const [bump, setBump] = useState(0);

  useEffect(() => {
    if (!args.sessionId) return;
    let cancelled = false;
    getMyRoom({ baseUrl: args.baseUrl, sessionId: args.sessionId })
      .then((res) => { if (!cancelled) setRoomId(res.roomId); })
      .catch(() => { if (!cancelled) setRoomId(null); });
    return () => { cancelled = true; };
  }, [args.baseUrl, args.sessionId, bump]);

  // Re-poll when the tab regains focus — covers the "user navigates away to
  // the room, plays or leaves, then hits the browser back button" case. The
  // lobby shows a stale "null" otherwise until a manual refresh.
  useEffect(() => {
    const onFocus = () => setBump((b) => b + 1);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, []);

  const refresh = useCallback(() => setBump((b) => b + 1), []);
  return { roomId, refresh };
}
