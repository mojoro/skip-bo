import { describe, it, expect } from 'vitest';
import { GameRegistry } from '../../src/game/registry';

function fakeConn(id: string) {
  const sent: unknown[] = [];
  const closes: Array<{ code: number; reason: string }> = [];
  return {
    id,
    sessionId: id,
    send: (msg: unknown) => sent.push(msg),
    close: (code: number, reason: string) => closes.push({ code, reason }),
    sent, closes,
  };
}

describe('GameRegistry', () => {
  it('adds and removes connections per room', () => {
    const reg = new GameRegistry();
    const a = fakeConn('a');
    const b = fakeConn('b');
    reg.add('room1', a);
    reg.add('room1', b);
    expect(reg.size('room1')).toBe(2);
    reg.remove('room1', a);
    expect(reg.size('room1')).toBe(1);
  });

  it('broadcast sends to every connection in a room', () => {
    const reg = new GameRegistry();
    const a = fakeConn('a');
    const b = fakeConn('b');
    reg.add('room1', a);
    reg.add('room1', b);
    reg.broadcast('room1', { type: 'ping' });
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
  });

  it('findBySession returns the single connection for a sessionId', () => {
    const reg = new GameRegistry();
    const a = fakeConn('alice');
    reg.add('r', a);
    expect(reg.findBySession('r', 'alice')).toBe(a);
    expect(reg.findBySession('r', 'bob')).toBeUndefined();
  });

  it('broadcastCloseAll calls close on every conn and empties rooms', () => {
    const reg = new GameRegistry();
    const a = fakeConn('a');
    const b = fakeConn('b');
    reg.add('r1', a);
    reg.add('r2', b);
    reg.broadcastCloseAll(1001, 'shutdown');
    expect(a.closes).toEqual([{ code: 1001, reason: 'shutdown' }]);
    expect(b.closes).toEqual([{ code: 1001, reason: 'shutdown' }]);
  });
});
