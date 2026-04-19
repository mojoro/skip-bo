import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RoomManager } from '../../src/room/manager';
import { defaultConfigForRuleset } from '@engine/types';

function baseConfig() {
  const c = defaultConfigForRuleset('recommended', 4);
  c.maxPlayers = 4;
  return c;
}

describe('lifecycle', () => {
  let mgr: RoomManager;
  beforeEach(() => {
    vi.useFakeTimers();
    mgr = new RoomManager();
  });

  it('host leave migrates to next joined human', () => {
    const { room } = mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfig(), allowAiFill: true, visibility: 'public' });
    mgr.addMember(room.id, { sessionId: 'a', playerName: 'A' });
    mgr.addMember(room.id, { sessionId: 'b', playerName: 'B' });
    mgr.removeMember(room.id, 'h', { actorSessionId: 'h' });
    expect(room.hostSessionId).toBe('a');
  });

  it('host leave from solo waiting room deletes the room', () => {
    const { room } = mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfig(), allowAiFill: true, visibility: 'public' });
    mgr.removeMember(room.id, 'h', { actorSessionId: 'h' });
    expect(mgr.get(room.id)).toBeUndefined();
  });

  it('startGame rejects when allowAiFill is off and open seats remain', () => {
    // Solo host at a 4-seat table with no explicit AI and allowAiFill: false.
    // Host must either toggle seats to AI, lock them, or enable fill.
    const { room } = mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfig(), allowAiFill: false, visibility: 'public' });
    expect(() => mgr.startGame(room.id, { actorSessionId: 'h' })).toThrow(/openSlots|tooFew/);
  });

  it('startGame fills open slots with AI when allowAiFill is on', () => {
    const { room } = mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfig(), allowAiFill: true, visibility: 'public' });
    mgr.addMember(room.id, { sessionId: 'a', playerName: 'A' });
    mgr.startGame(room.id, { actorSessionId: 'h' });
    expect(room.phase).toBe('playing');
    expect(room.slots.every((s) => s.kind === 'human' || s.kind === 'ai')).toBe(true);
  });

  it('startGame rejects non-host', () => {
    const { room } = mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfig(), allowAiFill: true, visibility: 'public' });
    mgr.addMember(room.id, { sessionId: 'a', playerName: 'A' });
    expect(() => mgr.startGame(room.id, { actorSessionId: 'a' })).toThrow(/host/);
  });

  it('idle timer deletes a waiting room after 30 minutes of no activity', () => {
    const { room } = mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfig(), allowAiFill: true, visibility: 'public' });
    vi.advanceTimersByTime(30 * 60 * 1000 + 1);
    expect(mgr.get(room.id)).toBeUndefined();
  });

  it('idle timer resets on mutation', () => {
    const { room } = mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfig(), allowAiFill: true, visibility: 'public' });
    vi.advanceTimersByTime(25 * 60 * 1000);
    mgr.addMember(room.id, { sessionId: 'a', playerName: 'A' });
    vi.advanceTimersByTime(25 * 60 * 1000);
    expect(mgr.get(room.id)).toBeDefined();
  });

  it('startGame auto-builds partnership teams from slot order (B1 audit)', () => {
    const config = baseConfig();
    config.maxPlayers = 4;
    config.partnership = {
      enabled: true,
      teams: [], // client sends empty — server rebuilds from slots
      allowPlayFromPartnerStock: true,
      allowPlayFromPartnerDiscard: true,
      allowDiscardToPartnerDiscard: false,
    };
    const { room } = mgr.create({ sessionId: 'h', playerName: 'H', config, allowAiFill: true, visibility: 'public' });
    mgr.addMember(room.id, { sessionId: 'a', playerName: 'A' });
    mgr.addMember(room.id, { sessionId: 'b', playerName: 'B' });
    mgr.addMember(room.id, { sessionId: 'c', playerName: 'C' });
    mgr.startGame(room.id, { actorSessionId: 'h' });
    expect(room.phase).toBe('playing');
    expect(room.game).not.toBeNull();
    // Engine partnership pairs slot i with slot i + half.
    expect(room.game!.config.partnership?.teams).toEqual([['h', 'b'], ['a', 'c']]);
  });

  it('self-leave during playing flips the seat to botControlled and frees the session', () => {
    const { room } = mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfig(), allowAiFill: true, visibility: 'public' });
    mgr.addMember(room.id, { sessionId: 'a', playerName: 'A' });
    mgr.startGame(room.id, { actorSessionId: 'h' });
    expect(room.phase).toBe('playing');
    mgr.removeMember(room.id, 'h', { actorSessionId: 'h' });
    const hostSlot = room.slots[0];
    expect(hostSlot?.kind).toBe('human');
    if (hostSlot?.kind === 'human') {
      expect(hostSlot.botControlled).toBe(true);
      expect(hostSlot.sessionId).toBe('h');
    }
    // Session is free to join another room.
    expect(mgr.sessionRoomId('h')).toBeUndefined();
  });

  it('host cannot kick another member during play', () => {
    const { room } = mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfig(), allowAiFill: true, visibility: 'public' });
    mgr.addMember(room.id, { sessionId: 'a', playerName: 'A' });
    mgr.startGame(room.id, { actorSessionId: 'h' });
    expect(() => mgr.removeMember(room.id, 'a', { actorSessionId: 'h' })).toThrow(/in progress/);
  });

  it('last live human leaving an in-progress game ends it as abandoned', () => {
    const { room } = mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfig(), allowAiFill: true, visibility: 'public' });
    mgr.addMember(room.id, { sessionId: 'a', playerName: 'A' });
    mgr.startGame(room.id, { actorSessionId: 'h' });
    mgr.removeMember(room.id, 'h', { actorSessionId: 'h' });
    expect(room.phase).toBe('playing');
    mgr.removeMember(room.id, 'a', { actorSessionId: 'a' });
    expect(room.phase).toBe('finished');
    // Neither session is still bound to the (now-finishing) room.
    expect(mgr.sessionRoomId('h')).toBeUndefined();
    expect(mgr.sessionRoomId('a')).toBeUndefined();
  });

  it('solo host who toggles the other seat to AI can start without AI fill', () => {
    // User-reported: "toggling a slot to be an AI doesn't allow the game to
    // be started even if all slots are accounted for." Explicit AI slots
    // count toward the playable minimum; allowAiFill still gates OPEN-seat
    // conversion specifically.
    const c = defaultConfigForRuleset('recommended', 2);
    c.maxPlayers = 2;
    const { room } = mgr.create({ sessionId: 'h', playerName: 'H', config: c, allowAiFill: false, visibility: 'public' });
    mgr.setSlot(room.id, 1, { kind: 'ai', difficulty: 'easy' }, { actorSessionId: 'h' });
    mgr.startGame(room.id, { actorSessionId: 'h' });
    expect(room.phase).toBe('playing');
    expect(room.slots[1]!.kind).toBe('ai');
  });

  it('startGame counts AI slots toward the 2-player minimum', () => {
    const { room } = mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfig(), allowAiFill: false, visibility: 'public' });
    // Host solo (1 human) + converts two open seats to AI + locks one.
    mgr.setSlot(room.id, 1, { kind: 'ai', difficulty: 'easy' }, { actorSessionId: 'h' });
    mgr.setSlot(room.id, 2, { kind: 'ai', difficulty: 'easy' }, { actorSessionId: 'h' });
    mgr.setSlot(room.id, 3, { kind: 'locked' }, { actorSessionId: 'h' });
    mgr.startGame(room.id, { actorSessionId: 'h' });
    expect(room.phase).toBe('playing');
  });

  it('session freed from a finished room can create a new one', () => {
    const { room } = mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfig(), allowAiFill: true, visibility: 'public' });
    mgr.addMember(room.id, { sessionId: 'a', playerName: 'A' });
    mgr.startGame(room.id, { actorSessionId: 'h' });
    mgr.finishGame(room.id, 'winner');
    // Finished rooms should not pin the session — the user is back in the
    // lobby and should be able to start something new.
    expect(() =>
      mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfig(), allowAiFill: true, visibility: 'public' }),
    ).not.toThrow();
  });

  it('finish cleans up after 5 minutes', () => {
    const { room } = mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfig(), allowAiFill: true, visibility: 'public' });
    mgr.addMember(room.id, { sessionId: 'a', playerName: 'A' });
    mgr.startGame(room.id, { actorSessionId: 'h' });
    mgr.finishGame(room.id, 'winner');
    expect(mgr.get(room.id)).toBeDefined();
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(mgr.get(room.id)).toBeUndefined();
  });
});
