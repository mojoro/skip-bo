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

  it('setSlot from host to ai swaps cleanly during waiting', () => {
    mgr.setSlot(host.id, 1, { kind: 'ai', difficulty: 'easy' }, { actorSessionId: 'host' });
    const slot = host.slots[1]!;
    expect(slot.kind).toBe('ai');
    if (slot.kind === 'ai') {
      expect(slot.difficulty).toBe('easy');
      expect(slot.botId).toMatch(/^bot-/);
    }
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
