import { describe, it, expect, beforeEach } from 'vitest';
import { RoomManager } from '../../src/room/manager';
import { defaultConfigForRuleset } from '@engine/types';

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
