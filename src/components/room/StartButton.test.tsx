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
  it('allows solo host with an explicitly-placed AI slot (regression)', () => {
    // Host toggled slot 1 to AI in the SlotList. allowAiFill off is fine
    // because no seats are left as "open" — the table is fully committed.
    expect(canStart({ humans: 1, ai: 1, open: 0, locked: 0, capacity: 2 }, false)).toBe(true);
  });
  it('allows start when allowAiFill and there is at least one human + open', () => {
    expect(canStart({ humans: 1, ai: 0, open: 1, locked: 0, capacity: 2 }, true)).toBe(true);
  });
  it('rejects solo host with one open seat when AI fill is off', () => {
    // Host must either toggle the open seat to AI, lock it, or enable fill.
    expect(canStart({ humans: 1, ai: 0, open: 1, locked: 0, capacity: 2 }, false)).toBe(false);
  });
  it('rejects when fewer than 2 playable seats exist', () => {
    // Solo human + locked sibling — no AI to pair with.
    expect(canStart({ humans: 1, ai: 0, open: 0, locked: 1, capacity: 2 }, true)).toBe(false);
  });
  it('rejects an all-AI table with no human owner', () => {
    expect(canStart({ humans: 0, ai: 2, open: 0, locked: 0, capacity: 2 }, false)).toBe(false);
  });
});

describe('StartButton', () => {
  it('is enabled when solo host has one explicit AI slot', () => {
    render(<StartButton
      slotSummary={{ humans: 1, ai: 1, open: 0, locked: 0, capacity: 2 }}
      allowAiFill={false} busy={false} onClick={() => {}}
    />);
    expect(screen.getByRole('button', { name: /start/i })).not.toBeDisabled();
  });

  it('is disabled when solo host has an open seat and AI fill is off', () => {
    render(<StartButton
      slotSummary={{ humans: 1, ai: 0, open: 1, locked: 0, capacity: 2 }}
      allowAiFill={false} busy={false} onClick={() => {}}
    />);
    expect(screen.getByRole('button', { name: /start/i })).toBeDisabled();
  });
});
