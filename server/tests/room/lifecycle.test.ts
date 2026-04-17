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

  it('startGame rejects with <2 players and no ai fill', () => {
    const { room } = mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfig(), allowAiFill: false, visibility: 'public' });
    expect(() => mgr.startGame(room.id, { actorSessionId: 'h' })).toThrow(/openSlots|tooFew/);
  });

  it('startGame fills open slots with AI when allowAiFill', () => {
    const { room } = mgr.create({ sessionId: 'h', playerName: 'H', config: baseConfig(), allowAiFill: true, visibility: 'public' });
    mgr.addMember(room.id, { sessionId: 'a', playerName: 'A' });
    mgr.startGame(room.id, { actorSessionId: 'h' });
    expect(room.phase).toBe('playing');
    expect(room.game).not.toBeNull();
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
