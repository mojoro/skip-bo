/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatsChip } from './StatsChip';

describe('StatsChip', () => {
  it('renders games and players', () => {
    render(<StatsChip stats={{ gamesInProgress: 3, playersOnline: 12 }} connected={true} />);
    expect(screen.getByText(/3 games · 12 online/i)).toBeInTheDocument();
  });

  it('shows reconnecting dot when disconnected', () => {
    render(<StatsChip stats={{ gamesInProgress: 0, playersOnline: 0 }} connected={false} />);
    expect(screen.getByLabelText(/reconnecting/i)).toBeInTheDocument();
  });
});
