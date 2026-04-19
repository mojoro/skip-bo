/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoomList } from './RoomList';

describe('RoomList', () => {
  it('renders empty state when no rooms', () => {
    render(<RoomList rooms={[]} onJoin={() => {}} />);
    expect(screen.getByText(/no public rooms yet/i)).toBeInTheDocument();
  });

  it('renders a RoomCard per room', () => {
    const rooms = [1, 2, 3].map((n) => ({
      id: `r-${n}`, code: null, displayName: `Table ${n}`, phase: 'waiting' as const,
      hostName: 'Host', allowAiFill: false, visibility: 'public' as const,
      slotSummary: { humans: 1, ai: 0, open: 1, locked: 0, capacity: 2 },
      config: { ruleset: 'recommended' as const, stockPileSize: 10, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null },
      createdAt: n,
    }));
    render(<RoomList rooms={rooms} onJoin={() => {}} />);
    expect(screen.getAllByText(/Table \d/)).toHaveLength(3);
  });
});
