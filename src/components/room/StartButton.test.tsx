/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StartButton, canStart } from './StartButton';

describe('canStart', () => {
  it('allows start when full human table', () => {
    expect(canStart({ humans: 2, ai: 0, open: 0, locked: 0, capacity: 2 }, false)).toBe(true);
  });
  it('allows solo host vs AI with one open seat (auto-fills at start)', () => {
    // Regression: previously gated on allowAiFill. Now any open seat is
    // treated as AI-fillable at start time so a host clicking Start before
    // friends arrive gets a valid human-vs-bot game.
    expect(canStart({ humans: 1, ai: 0, open: 1, locked: 0, capacity: 2 }, false)).toBe(true);
  });
  it('allows solo host with an explicitly-placed AI slot', () => {
    expect(canStart({ humans: 1, ai: 1, open: 0, locked: 2, capacity: 4 }, false)).toBe(true);
  });
  it('rejects a solo human at a 2-seat table where the other seat is locked', () => {
    // Locked means intentionally empty; with no opens or AI to fill the seat
    // there aren't two playable positions.
    expect(canStart({ humans: 1, ai: 0, open: 0, locked: 1, capacity: 2 }, true)).toBe(false);
  });
  it('rejects an all-AI table with no human owner', () => {
    expect(canStart({ humans: 0, ai: 2, open: 0, locked: 0, capacity: 2 }, false)).toBe(false);
  });
});

describe('StartButton', () => {
  it('is enabled for solo host + one open seat at a 2-seat table', () => {
    render(<StartButton
      slotSummary={{ humans: 1, ai: 0, open: 1, locked: 0, capacity: 2 }}
      allowAiFill={false} busy={false} onClick={() => {}}
    />);
    expect(screen.getByRole('button', { name: /start/i })).not.toBeDisabled();
  });

  it('is disabled when only one playable seat remains', () => {
    render(<StartButton
      slotSummary={{ humans: 1, ai: 0, open: 0, locked: 1, capacity: 2 }}
      allowAiFill={false} busy={false} onClick={() => {}}
    />);
    expect(screen.getByRole('button', { name: /start/i })).toBeDisabled();
  });
});
