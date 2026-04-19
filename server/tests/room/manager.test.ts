import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RoomManager } from '../../src/room/manager';
import { defaultConfigForRuleset } from '@engine/types';
import type { Room } from '../../src/types';

function baseConfig() {
  const c = defaultConfigForRuleset('recommended', 4);
  c.maxPlayers = 4;
  return c;
}

describe('RoomManager create/get/list', () => {
  let mgr: RoomManager;
  beforeEach(() => { mgr = new RoomManager(); });

  it('creates a public room with host in slot 0', () => {
    const { room } = mgr.create({
      sessionId: 's1',
      playerName: 'John',
      config: baseConfig(),
      allowAiFill: true,
      visibility: 'public',
    });
    expect(room.phase).toBe('waiting');
    expect(room.slots[0]).toMatchObject({ kind: 'human', sessionId: 's1', name: 'John' });
    expect(room.slots.slice(1).every((s) => s.kind === 'open')).toBe(true);
    expect(room.hostSessionId).toBe('s1');
    expect(room.code).toMatch(/^[A-Z2-9]{6}$/);
  });

  it('autogenerates a displayName when not provided', () => {
    const { room } = mgr.create({
      sessionId: 's1', playerName: 'John',
      config: baseConfig(), allowAiFill: true, visibility: 'public',
    });
    expect(room.displayName).toBe("John's table");
  });

  it('honors an explicit displayName', () => {
    const { room } = mgr.create({
      sessionId: 's1', playerName: 'John', displayName: 'Custom Night',
      config: baseConfig(), allowAiFill: true, visibility: 'public',
    });
    expect(room.displayName).toBe('Custom Night');
  });

  it('get returns the room by id', () => {
    const { room } = mgr.create({
      sessionId: 's1', playerName: 'John',
      config: baseConfig(), allowAiFill: true, visibility: 'public',
    });
    expect(mgr.get(room.id)?.id).toBe(room.id);
    expect(mgr.get('nope')).toBeUndefined();
  });

  it('findByCode is case-insensitive', () => {
    const { room } = mgr.create({
      sessionId: 's1', playerName: 'John',
      config: baseConfig(), allowAiFill: true, visibility: 'public',
    });
    expect(mgr.findByCode(room.code.toLowerCase())?.id).toBe(room.id);
    expect(mgr.findByCode('ZZZZZZ')).toBeUndefined();
  });

  it('listPublicWaiting excludes private rooms', () => {
    mgr.create({ sessionId: 'a', playerName: 'A', config: baseConfig(), allowAiFill: true, visibility: 'public' });
    mgr.create({ sessionId: 'b', playerName: 'B', config: baseConfig(), allowAiFill: true, visibility: 'private' });
    const rooms = mgr.listPublicWaiting();
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.visibility).toBe('public');
  });

  it('enforces one-session-one-room invariant', () => {
    mgr.create({ sessionId: 's1', playerName: 'John', config: baseConfig(), allowAiFill: true, visibility: 'public' });
    expect(() =>
      mgr.create({ sessionId: 's1', playerName: 'John2', config: baseConfig(), allowAiFill: true, visibility: 'public' }),
    ).toThrow(/already seated/);
  });

  it('rejects code collisions via retry (smoke test)', () => {
    for (let i = 0; i < 50; i++) {
      mgr.create({ sessionId: `s${i}`, playerName: `P${i}`, config: baseConfig(), allowAiFill: true, visibility: 'public' });
    }
    expect(mgr.listPublicWaiting()).toHaveLength(50);
  });
});

describe('RoomManager join/leave/slots', () => {
  let mgr: RoomManager;
  let host: Room;
  beforeEach(() => {
    mgr = new RoomManager();
    host = mgr.create({
      sessionId: 'host',
      playerName: 'Host',
      config: baseConfig(),
      allowAiFill: true,
      visibility: 'public',
    }).room;
  });

  it('addMember claims the first open slot', () => {
    const { slotIndex } = mgr.addMember(host.id, { sessionId: 's2', playerName: 'P2' });
    expect(slotIndex).toBe(1);
    const slot = host.slots[1]!;
    expect(slot.kind).toBe('human');
    if (slot.kind === 'human') {
      expect(slot.sessionId).toBe('s2');
      expect(slot.name).toBe('P2');
    }
  });

  it('addMember rejects kicked sessions', () => {
    mgr.addMember(host.id, { sessionId: 's2', playerName: 'P2' });
    mgr.setSlot(host.id, 1, { kind: 'open' }, { actorSessionId: 'host' });
    expect(() =>
      mgr.addMember(host.id, { sessionId: 's2', playerName: 'P2' }),
    ).toThrow(/kicked/);
  });

  it('addMember rejects full rooms', () => {
    mgr.addMember(host.id, { sessionId: 'a', playerName: 'A' });
    mgr.addMember(host.id, { sessionId: 'b', playerName: 'B' });
    mgr.addMember(host.id, { sessionId: 'c', playerName: 'C' });
    expect(() =>
      mgr.addMember(host.id, { sessionId: 'd', playerName: 'D' }),
    ).toThrow(/full/);
  });

  it('addMember rejects duplicate session across rooms', () => {
    const other = mgr.create({
      sessionId: 's2', playerName: 'Other',
      config: baseConfig(), allowAiFill: true, visibility: 'public',
    }).room;
    expect(() =>
      mgr.addMember(host.id, { sessionId: 's2', playerName: 'Other' }),
    ).toThrow(/already seated/);
    expect(other.slots[0]!.kind).toBe('human');
  });

  it('removeMember self-leave opens the slot', () => {
    mgr.addMember(host.id, { sessionId: 's2', playerName: 'P2' });
    mgr.removeMember(host.id, 's2', { actorSessionId: 's2' });
    expect(host.slots[1]!.kind).toBe('open');
  });

  it('removeMember rejects host kicks during playing but allows self-leave', () => {
    mgr.addMember(host.id, { sessionId: 's2', playerName: 'P2' });
    mgr.startGame(host.id, { actorSessionId: 'host' });
    // Host cannot kick another player mid-game — would orphan the engine slot.
    expect(() =>
      mgr.removeMember(host.id, 's2', { actorSessionId: 'host' }),
    ).toThrow(/in progress/);
    // But s2 is free to leave themselves; the seat flips to bot-controlled
    // and the sessionIndex is freed so they can join elsewhere.
    mgr.removeMember(host.id, 's2', { actorSessionId: 's2' });
    const room = mgr.get(host.id)!;
    const slot = room.slots[1]!;
    expect(slot.kind).toBe('human');
    if (slot.kind === 'human') {
      expect(slot.botControlled).toBe(true);
      expect(slot.sessionId).toBe('s2');
    }
    expect(mgr.sessionRoomId('s2')).toBeUndefined();
  });

  it('setSlot from host to ai swaps cleanly during waiting', () => {
    mgr.setSlot(host.id, 1, { kind: 'ai', difficulty: 'easy' }, { actorSessionId: 'host' });
    const slot = host.slots[1]!;
    expect(slot.kind).toBe('ai');
    if (slot.kind === 'ai') {
      expect(slot.difficulty).toBe('easy');
      expect(slot.botId).toMatch(/^bot-/);
    }
  });

  it('setSlot frees the displaced human sessionIndex for any new slot kind', () => {
    mgr.addMember(host.id, { sessionId: 's2', playerName: 'P2' });
    mgr.setSlot(host.id, 1, { kind: 'ai', difficulty: 'easy' }, { actorSessionId: 'host' });
    // s2 should now be free to join another room.
    const other = mgr.create({
      sessionId: 's2', playerName: 'P2',
      config: baseConfig(), allowAiFill: true, visibility: 'public',
    });
    expect(other.room.hostSessionId).toBe('s2');
  });

  it('setSlot rejects non-host actors', () => {
    mgr.addMember(host.id, { sessionId: 's2', playerName: 'P2' });
    expect(() =>
      mgr.setSlot(host.id, 2, { kind: 'locked' }, { actorSessionId: 's2' }),
    ).toThrow(/not host|Only the host/);
  });

  it('setSlot rejects self-kick by host', () => {
    expect(() =>
      mgr.setSlot(host.id, 0, { kind: 'open' }, { actorSessionId: 'host' }),
    ).toThrow(/self-kick|cannot self-kick/);
  });

  it('kicking a human adds them to kickedSessionIds', () => {
    mgr.addMember(host.id, { sessionId: 's2', playerName: 'P2' });
    mgr.setSlot(host.id, 1, { kind: 'open' }, { actorSessionId: 'host' });
    expect(host.kickedSessionIds.has('s2')).toBe(true);
  });
});

describe('RoomManager roomRemoved dedup', () => {
  it('emits roomRemoved exactly once when finish then cleanup runs', async () => {
    vi.useFakeTimers();
    try {
      const mgr = new RoomManager();
      const removed: string[] = [];
      mgr.events.on('roomRemoved', (e) => removed.push(e.roomId));
      const { room } = mgr.create({
        sessionId: 's1', playerName: 'Host',
        config: { ruleset: 'recommended', stockPileSize: 20, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null },
        allowAiFill: true, visibility: 'public',
      });
      mgr.addMember(room.id, { sessionId: 's2', playerName: 'P2' });
      mgr.startGame(room.id, { actorSessionId: 's1' }); // first roomRemoved (lobby leave)
      mgr.finishGame(room.id, 'winner');                 // second emit
      vi.advanceTimersByTime(6 * 60 * 1000);             // fire cleanup timer
      expect(removed.filter((id) => id === room.id)).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('RoomManager.createRematchRoom', () => {
  function makePlayingRoom() {
    const mgr = new RoomManager();
    const { room } = mgr.create({
      sessionId: 'sess-alice',
      playerName: 'Alice',
      config: { ruleset: 'recommended', stockPileSize: 5, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null },
      allowAiFill: false,
      visibility: 'public',
    });
    mgr.addMember(room.id, { sessionId: 'sess-bob', playerName: 'Bob' });
    mgr.startGame(room.id, { actorSessionId: 'sess-alice' });
    return { mgr, room };
  }

  it('creates a new room in playing phase with a game state already initialized', () => {
    const { mgr, room } = makePlayingRoom();
    mgr.finishGame(room.id, 'winner');
    const seatedHumans = room.slots
      .filter((s) => s.kind === 'human')
      .map((s) => ({
        sessionId: (s as Extract<typeof s, { kind: 'human' }>).sessionId,
        name: (s as Extract<typeof s, { kind: 'human' }>).name,
        slotIndex: room.slots.indexOf(s),
      }));

    const { room: next } = mgr.createRematchRoom({ sourceRoom: room, seatedHumans });
    expect(next.phase).toBe('playing');
    expect(next.game).not.toBeNull();
    expect(next.config.ruleset).toBe(room.config.ruleset);
    expect(next.config.maxPlayers).toBe(room.config.maxPlayers);
  });

  it('pre-seats each human at their original slot index with botControlled=true', () => {
    const { mgr, room } = makePlayingRoom();
    mgr.finishGame(room.id, 'winner');
    const originals = room.slots.map((s, i) => ({ slot: s, i }));
    const seatedHumans = originals
      .filter((x) => x.slot.kind === 'human')
      .map((x) => ({
        sessionId: (x.slot as Extract<typeof x.slot, { kind: 'human' }>).sessionId,
        name: (x.slot as Extract<typeof x.slot, { kind: 'human' }>).name,
        slotIndex: x.i,
      }));

    const { room: next } = mgr.createRematchRoom({ sourceRoom: room, seatedHumans });
    for (const entry of seatedHumans) {
      const slot = next.slots[entry.slotIndex];
      expect(slot).toBeDefined();
      expect(slot!.kind).toBe('human');
      if (slot && slot.kind === 'human') {
        expect(slot.sessionId).toBe(entry.sessionId);
        expect(slot.name).toBe(entry.name);
        expect(slot.connected).toBe(false);
        expect(slot.botControlled).toBe(true);
        expect(slot.graceDeadline).toBeNull();
      }
    }
  });

  it('migrates each seated sessionIndex from source to new room atomically', () => {
    const { mgr, room } = makePlayingRoom();
    mgr.finishGame(room.id, 'winner');
    const seatedHumans = room.slots
      .map((slot, i) => ({ slot, i }))
      .filter((x) => x.slot.kind === 'human')
      .map((x) => ({
        sessionId: (x.slot as Extract<typeof x.slot, { kind: 'human' }>).sessionId,
        name: (x.slot as Extract<typeof x.slot, { kind: 'human' }>).name,
        slotIndex: x.i,
      }));
    const { room: next } = mgr.createRematchRoom({ sourceRoom: room, seatedHumans });
    for (const s of seatedHumans) {
      expect(mgr.sessionRoomId(s.sessionId)).toBe(next.id);
    }
  });

  it('sets hostSessionId to the first seated human (slot 0)', () => {
    const { mgr, room } = makePlayingRoom();
    mgr.finishGame(room.id, 'winner');
    const seatedHumans = room.slots
      .map((slot, i) => ({ slot, i }))
      .filter((x) => x.slot.kind === 'human')
      .map((x) => ({
        sessionId: (x.slot as Extract<typeof x.slot, { kind: 'human' }>).sessionId,
        name: (x.slot as Extract<typeof x.slot, { kind: 'human' }>).name,
        slotIndex: x.i,
      }));
    const { room: next } = mgr.createRematchRoom({ sourceRoom: room, seatedHumans });
    expect(next.hostSessionId).toBe(seatedHumans[0]!.sessionId);
  });

  it('generates a fresh seed so the cloned config does not replay the original shuffle', () => {
    const { mgr, room } = makePlayingRoom();
    mgr.finishGame(room.id, 'winner');
    room.config.seed = 42; // ensure guard always runs
    const seatedHumans = room.slots
      .map((slot, i) => ({ slot, i }))
      .filter((x) => x.slot.kind === 'human')
      .map((x) => ({
        sessionId: (x.slot as Extract<typeof x.slot, { kind: 'human' }>).sessionId,
        name: (x.slot as Extract<typeof x.slot, { kind: 'human' }>).name,
        slotIndex: x.i,
      }));
    const { room: next } = mgr.createRematchRoom({ sourceRoom: room, seatedHumans });
    expect(next.config.seed).not.toBe(room.config.seed);
  });

  it('does not delete reassigned sessionIndex entries when source room cleanup fires', () => {
    const { mgr, room } = makePlayingRoom();
    mgr.finishGame(room.id, 'winner');
    const seatedHumans = room.slots
      .map((slot, i) => ({ slot, i }))
      .filter((x) => x.slot.kind === 'human')
      .map((x) => ({
        sessionId: (x.slot as Extract<typeof x.slot, { kind: 'human' }>).sessionId,
        name: (x.slot as Extract<typeof x.slot, { kind: 'human' }>).name,
        slotIndex: x.i,
      }));
    const { room: next } = mgr.createRematchRoom({ sourceRoom: room, seatedHumans });
    // Force-trigger the source room's deletion (post-game cleanup path).
    (mgr as any).deleteRoom(room, { reason: 'postGame' });
    for (const s of seatedHumans) {
      expect(mgr.sessionRoomId(s.sessionId)).toBe(next.id);
    }
  });

  it('clones AI slots and leaves open/locked slots as-is', () => {
    const mgr = new RoomManager();
    const { room } = mgr.create({
      sessionId: 'sess-alice',
      playerName: 'Alice',
      config: { ruleset: 'recommended', stockPileSize: 5, handSize: 5, bidirectionalBuild: true, maxPlayers: 4, partnership: null },
      allowAiFill: false,
      visibility: 'public',
    });
    room.slots[1] = { kind: 'ai', botId: 'bot-123', difficulty: 'easy' };
    room.slots[2] = { kind: 'locked' };
    // slot 3 remains 'open' — we flip phase manually below to bypass startGame's
    // open-slots guard rather than toggling allowAiFill (would convert the open
    // slot into AI and mask the "open stays open" assertion).
    room.phase = 'finished';
    room.finishedAt = Date.now();
    const seatedHumans = [
      { sessionId: 'sess-alice', name: 'Alice', slotIndex: 0 },
    ];
    const { room: next } = mgr.createRematchRoom({ sourceRoom: room, seatedHumans });
    expect(next.slots[1]!.kind).toBe('ai');
    expect(next.slots[2]!.kind).toBe('locked');
    expect(next.slots[3]!.kind).toBe('open');
  });
});
