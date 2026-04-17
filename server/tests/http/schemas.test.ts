import { describe, it, expect } from 'vitest';
import {
  createRoomSchema,
  joinRoomSchema,
  patchRoomSchema,
  setSlotSchema,
} from '../../src/http/schemas';

describe('schemas', () => {
  const cfg = {
    ruleset: 'recommended' as const, stockPileSize: 20, handSize: 5,
    bidirectionalBuild: true, maxPlayers: 4, partnership: null,
  };

  it('accepts a valid create-room payload', () => {
    const parsed = createRoomSchema.parse({
      playerName: 'John', config: cfg, allowAiFill: true, visibility: 'public',
    });
    expect(parsed.playerName).toBe('John');
  });

  it('rejects a playerName that is empty', () => {
    expect(() => createRoomSchema.parse({
      playerName: '', config: cfg, allowAiFill: true, visibility: 'public',
    })).toThrow();
  });

  it('rejects out-of-range maxPlayers', () => {
    expect(() => createRoomSchema.parse({
      playerName: 'John', config: { ...cfg, maxPlayers: 99 }, allowAiFill: true, visibility: 'public',
    })).toThrow();
  });

  it('joinRoomSchema requires playerName', () => {
    expect(joinRoomSchema.parse({ playerName: 'John' }).playerName).toBe('John');
    expect(() => joinRoomSchema.parse({})).toThrow();
  });

  it('patchRoomSchema accepts partial updates', () => {
    const parsed = patchRoomSchema.parse({ visibility: 'private' });
    expect(parsed.visibility).toBe('private');
  });

  it('setSlotSchema discriminates kinds', () => {
    expect(setSlotSchema.parse({ kind: 'open' })).toEqual({ kind: 'open' });
    expect(setSlotSchema.parse({ kind: 'ai', difficulty: 'easy' }).kind).toBe('ai');
    expect(() => setSlotSchema.parse({ kind: 'human' })).toThrow();
  });
});
