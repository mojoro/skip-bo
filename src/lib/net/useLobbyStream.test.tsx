/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLobbyStream } from './useLobbyStream';

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  readyState = 0;
  private listeners = new Map<string, Array<(e: MessageEvent) => void>>();
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(fn);
  }
  removeEventListener(type: string, fn: (e: MessageEvent) => void) {
    const arr = this.listeners.get(type);
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }
  close() { this.readyState = 2; }
  fire(type: string, data: unknown, lastEventId = '') {
    const ev = new MessageEvent(type, { data: JSON.stringify(data), lastEventId });
    (this.listeners.get(type) ?? []).forEach((fn) => fn(ev));
  }
  openConnection() {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }
}

beforeEach(() => {
  vi.stubGlobal('EventSource', MockEventSource);
  MockEventSource.instances.length = 0;
});

describe('useLobbyStream', () => {
  it('hydrates from snapshot event', () => {
    const { result } = renderHook(() => useLobbyStream({
      baseUrl: 'http://localhost:8787',
      sessionId: 's-1',
    }));
    const es = MockEventSource.instances[0]!;
    act(() => {
      es.openConnection();
      es.fire('snapshot', {
        type: 'snapshot',
        rooms: [{ id: 'r1', code: null, displayName: 'Table', phase: 'waiting', hostName: 'Alice', createdAt: 0, allowAiFill: false, visibility: 'public', slotSummary: { humans: 1, ai: 0, open: 1, locked: 0, capacity: 2 }, config: {} as any }],
        stats: { gamesInProgress: 0, playersOnline: 1 },
      });
    });
    expect(result.current.rooms).toHaveLength(1);
    expect(result.current.stats.playersOnline).toBe(1);
    expect(result.current.connected).toBe(true);
  });

  it('upserts on roomAdded and deletes on roomRemoved', () => {
    const { result } = renderHook(() => useLobbyStream({
      baseUrl: 'http://localhost:8787',
      sessionId: 's-1',
    }));
    const es = MockEventSource.instances[0]!;
    act(() => {
      es.openConnection();
      es.fire('snapshot', { type: 'snapshot', rooms: [], stats: { gamesInProgress: 0, playersOnline: 0 } });
      es.fire('roomAdded', { type: 'roomAdded', room: { id: 'r2', code: null, displayName: 'New', phase: 'waiting', hostName: 'Bob', createdAt: 0, allowAiFill: false, visibility: 'public', slotSummary: { humans: 1, ai: 0, open: 1, locked: 0, capacity: 2 }, config: {} as any } });
    });
    expect(result.current.rooms.map((r) => r.id)).toEqual(['r2']);
    act(() => {
      es.fire('roomRemoved', { type: 'roomRemoved', roomId: 'r2' });
    });
    expect(result.current.rooms).toHaveLength(0);
  });
});
