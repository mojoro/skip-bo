'use client';

import type { RoomInfo } from '@/lib/net/protocol';
import { RoomCard } from './RoomCard';

export interface RoomListProps {
  rooms: RoomInfo[];
  onJoin: (roomId: string) => void;
}

export function RoomList({ rooms, onJoin }: RoomListProps) {
  if (rooms.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/15 bg-black/20 px-6 py-8 text-center text-sm text-white/50">
        No public rooms yet. Create one to get started.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {rooms.map((room) => (
        <RoomCard key={room.id} room={room} onJoin={onJoin} />
      ))}
    </div>
  );
}
