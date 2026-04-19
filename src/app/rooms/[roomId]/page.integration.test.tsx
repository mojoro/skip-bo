/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { Suspense } from 'react';
import NetworkedRoomPage from './page';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

class MockWebSocket {
  static last: MockWebSocket | null = null;
  readyState = 0; OPEN = 1; CLOSED = 3;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  bufferedAmount = 0;
  constructor(public url: string) { MockWebSocket.last = this; }
  send() {}
  close(code = 1000, reason = '') { this.onclose?.(new CloseEvent('close', { code, reason })); }
  deliver(msg: unknown) { this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(msg) })); }
  open() { this.readyState = 1; this.onopen?.(new Event('open')); }
}

beforeEach(() => {
  push.mockReset();
  MockWebSocket.last = null;
  vi.stubGlobal('WebSocket', MockWebSocket);
  localStorage.setItem('skipboSessionId', 'test-session');
});

describe('rooms/[roomId] phase branch', () => {
  it('renders PreGameRoom when hello has view: null', async () => {
    // Wrap render in async act so React can resolve use(params) suspension
    await act(async () => {
      render(
        <Suspense fallback={null}>
          <NetworkedRoomPage params={Promise.resolve({ roomId: 'r-1' })} />
        </Suspense>,
      );
    });
    // Wait for sessionId to hydrate from localStorage and WebSocket to be created
    await waitFor(() => expect(MockWebSocket.last).not.toBeNull());
    act(() => { MockWebSocket.last!.open(); });
    act(() => {
      MockWebSocket.last!.deliver({
        type: 'hello', stateVersion: 0,
        view: {
          view: null,
          seats: [
            { slotIndex: 0, kind: 'human', name: 'Me', connected: true, graceDeadline: null, botControlled: false, isHost: true },
            { slotIndex: 1, kind: 'open', name: null, connected: false, graceDeadline: null, botControlled: false, isHost: false },
          ],
          hostSlotIndex: 0,
          config: { ruleset: 'recommended', stockPileSize: 10, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null },
          allowAiFill: false,
          youSlotIndex: 0,
        },
      });
    });
    expect(await screen.findByText(/waiting room/i)).toBeInTheDocument();
  });
});
