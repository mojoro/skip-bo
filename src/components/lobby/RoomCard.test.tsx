/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RoomCard } from './RoomCard';
import type { RoomInfo } from '@/lib/net/protocol';

function mkRoom(overrides: Partial<RoomInfo> = {}): RoomInfo {
  return {
    id: 'r-1', code: null, displayName: "Alice's table", phase: 'waiting', hostName: 'Alice',
    allowAiFill: false, visibility: 'public',
    slotSummary: { humans: 1, ai: 0, open: 1, locked: 0, capacity: 2 },
    config: { ruleset: 'recommended', stockPileSize: 10, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null },
    createdAt: 0, ...overrides,
  };
}

describe('RoomCard', () => {
  it('renders display name, host, slot counts, ruleset', () => {
    render(<RoomCard room={mkRoom()} onJoin={() => {}} />);
    expect(screen.getByText(/Alice's table/)).toBeInTheDocument();
    expect(screen.getAllByText(/Alice/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/1\/2/)).toBeInTheDocument();
    expect(screen.getByText(/recommended/i)).toBeInTheDocument();
  });

  it('disables Join when full and AI fill off', () => {
    const room = mkRoom({ slotSummary: { humans: 2, ai: 0, open: 0, locked: 0, capacity: 2 } });
    render(<RoomCard room={room} onJoin={() => {}} />);
    expect(screen.getByRole('button', { name: /join/i })).toBeDisabled();
  });

  it('fires onJoin with room id', () => {
    const spy = vi.fn();
    render(<RoomCard room={mkRoom()} onJoin={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /join/i }));
    expect(spy).toHaveBeenCalledWith('r-1');
  });
});
