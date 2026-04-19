/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import LandingPage from './page';

// Mock next/navigation
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

// Mock next/link so it renders a plain anchor in jsdom
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

class MockEventSource {
  static last: MockEventSource | null = null;
  url: string;
  private listeners = new Map<string, Array<(e: MessageEvent) => void>>();
  onopen: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  constructor(url: string) { this.url = url; MockEventSource.last = this; }
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
  close() {}
  fire(type: string, data: unknown) {
    const ev = new MessageEvent(type, { data: JSON.stringify(data) });
    (this.listeners.get(type) ?? []).forEach((fn) => fn(ev));
  }
}

const fetchMock = vi.fn();

beforeEach(() => {
  push.mockReset();
  fetchMock.mockReset();
  MockEventSource.last = null;
  vi.stubGlobal('EventSource', MockEventSource);
  vi.stubGlobal('fetch', fetchMock);
  localStorage.setItem('skipboSessionId', 'test-session');
  localStorage.setItem('skipboDisplayName', 'Tester');
});

describe('LandingPage integration', () => {
  it('joins a room from the snapshot and navigates', async () => {
    fetchMock.mockResolvedValue(new Response(
      JSON.stringify({ slotIndex: 1, room: { id: 'r-abc' } }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    ));
    render(<LandingPage />);
    await waitFor(() => expect(MockEventSource.last).not.toBeNull());
    act(() => {
      MockEventSource.last!.fire('snapshot', {
        type: 'snapshot',
        rooms: [{
          id: 'r-abc', code: null, displayName: 'Cool Table', phase: 'waiting', hostName: 'Alice',
          allowAiFill: false, visibility: 'public',
          slotSummary: { humans: 1, ai: 0, open: 1, locked: 0, capacity: 2 },
          config: { ruleset: 'recommended', stockPileSize: 10, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null },
          createdAt: 0,
        }],
        stats: { gamesInProgress: 0, playersOnline: 1 },
      });
    });
    // Two "Join" buttons exist: room card + join-by-code submit; click the first (room card)
    fireEvent.click(screen.getAllByRole('button', { name: /join/i })[0]);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/rooms/r-abc'));
  });
});
