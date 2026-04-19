export interface RegisteredConnection {
  sessionId: string;
  send(message: unknown): void;
  close(code: number, reason: string): void;
}

export class GameRegistry {
  private readonly rooms = new Map<string, Set<RegisteredConnection>>();
  private readonly rematchBySourceRoom = new Map<string, string>();

  add(roomId: string, conn: RegisteredConnection): void {
    let set = this.rooms.get(roomId);
    if (!set) { set = new Set(); this.rooms.set(roomId, set); }
    set.add(conn);
  }

  remove(roomId: string, conn: RegisteredConnection): void {
    const set = this.rooms.get(roomId);
    if (!set) return;
    set.delete(conn);
    if (set.size === 0) this.rooms.delete(roomId);
  }

  size(roomId: string): number {
    return this.rooms.get(roomId)?.size ?? 0;
  }

  findBySession(roomId: string, sessionId: string): RegisteredConnection | undefined {
    const set = this.rooms.get(roomId);
    if (!set) return undefined;
    for (const conn of set) if (conn.sessionId === sessionId) return conn;
    return undefined;
  }

  forEachInRoom(roomId: string, fn: (conn: RegisteredConnection) => void): void {
    const set = this.rooms.get(roomId);
    if (!set) return;
    for (const conn of [...set]) fn(conn);
  }

  broadcast(roomId: string, message: unknown): void {
    this.forEachInRoom(roomId, (c) => c.send(message));
  }

  broadcastCloseAll(code: number, reason: string): void {
    // Snapshot entries before iterating so we match the defensive pattern in
    // forEachInRoom: a sync close handler could otherwise mutate the Map
    // mid-iteration (doc-audit #7). ECMAScript Map iterator semantics would
    // make this safe today, but consistency beats trusting iterator subtleties.
    const snapshot = [...this.rooms.entries()];
    this.rooms.clear();
    for (const [, set] of snapshot) {
      for (const conn of set) conn.close(code, reason);
      set.clear();
    }
  }

  allConnections(): RegisteredConnection[] {
    const out: RegisteredConnection[] = [];
    for (const set of this.rooms.values()) for (const c of set) out.push(c);
    return out;
  }

  getRematchRoomId(sourceRoomId: string): string | null {
    return this.rematchBySourceRoom.get(sourceRoomId) ?? null;
  }

  setRematchRoomId(sourceRoomId: string, newRoomId: string): void {
    this.rematchBySourceRoom.set(sourceRoomId, newRoomId);
  }
}
