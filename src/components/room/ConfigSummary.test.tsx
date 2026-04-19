/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfigSummary } from './ConfigSummary';

describe('ConfigSummary', () => {
  const config = { ruleset: 'recommended', stockPileSize: 20, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null } as any;

  it('renders readable key/value list', () => {
    render(<ConfigSummary config={config} isHost={false} onEdit={() => {}} />);
    expect(screen.getByText(/recommended/i)).toBeInTheDocument();
    expect(screen.getByText(/20/)).toBeInTheDocument();
  });

  it('shows Edit button only to host', () => {
    const spy = vi.fn();
    const { rerender } = render(<ConfigSummary config={config} isHost={false} onEdit={spy} />);
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
    rerender(<ConfigSummary config={config} isHost={true} onEdit={spy} />);
    fireEvent.click(screen.getByRole('button', { name: /edit/i }));
    expect(spy).toHaveBeenCalled();
  });
});
