/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import NewGameModal from './NewGameModal';
import type { NewGameSettings } from './NewGameModal';

afterEach(() => cleanup());

const baseInitial: NewGameSettings = {
  playerCount: 3,
  ruleset: 'official',
  stockPileSize: 30,
  handSize: 5,
  bidirectionalBuild: false,
  partnershipEnabled: false,
  partnershipAllowDiscardToPartner: false,
};

describe('NewGameModal edit mode', () => {
  it('locks player count buttons when editMode is true', () => {
    render(
      <NewGameModal
        open={true}
        onCancel={() => {}}
        onStart={() => {}}
        defaultPlayerCount={3}
        initial={baseInitial}
        editMode
      />,
    );
    // All player count buttons should have disabled attribute
    const playerButtons = [2, 3, 4, 5, 6, 7, 8].map((n) =>
      screen.getByRole('button', { name: String(n) }),
    );
    for (const btn of playerButtons) {
      expect(btn.hasAttribute('disabled')).toBe(true);
    }
  });

  it('passes initial settings to the form and prefills', () => {
    const onStart = vi.fn();
    render(
      <NewGameModal
        open={true}
        onCancel={() => {}}
        onStart={onStart}
        defaultPlayerCount={3}
        initial={baseInitial}
      />,
    );
    // Use getAllByRole and pick the last one (Cancel, then Start Game)
    const startBtn = screen.getAllByRole('button', { name: /start game/i })[0]!;
    fireEvent.click(startBtn);
    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({ ruleset: 'official', stockPileSize: 30 }),
    );
  });
});
