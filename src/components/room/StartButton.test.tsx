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
  it('allows start when allowAiFill and at least one human', () => {
    expect(canStart({ humans: 1, ai: 0, open: 1, locked: 0, capacity: 2 }, true)).toBe(true);
  });
  it('allows start when a solo host has an explicit AI slot (regression)', () => {
    // Host toggled one seat to AI, locked the rest. allowAiFill off is fine
    // because every seat is already accounted for.
    expect(canStart({ humans: 1, ai: 1, open: 0, locked: 2, capacity: 4 }, false)).toBe(true);
  });
  it('rejects when under 2 total seated', () => {
    expect(canStart({ humans: 1, ai: 0, open: 0, locked: 1, capacity: 2 }, true)).toBe(false);
  });
  it('rejects when open slots and no AI fill', () => {
    expect(canStart({ humans: 1, ai: 0, open: 1, locked: 0, capacity: 2 }, false)).toBe(false);
  });
  it('rejects an all-AI table with no human owner', () => {
    expect(canStart({ humans: 0, ai: 2, open: 0, locked: 0, capacity: 2 }, false)).toBe(false);
  });
});

describe('StartButton', () => {
  it('disables with tooltip when canStart false', () => {
    render(<StartButton
      slotSummary={{ humans: 1, ai: 0, open: 1, locked: 0, capacity: 2 }}
      allowAiFill={false} busy={false} onClick={() => {}}
    />);
    expect(screen.getByRole('button', { name: /start/i })).toBeDisabled();
  });
});
