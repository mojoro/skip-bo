/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SlotList } from './SlotList';
import type { GameViewSeat } from '@/lib/net/protocol';

const seats: GameViewSeat[] = [
  { slotIndex: 0, kind: 'human', name: 'Alice', connected: true, graceDeadline: null, botControlled: false, isHost: true },
  { slotIndex: 1, kind: 'open', name: null, connected: false, graceDeadline: null, botControlled: false, isHost: false },
  { slotIndex: 2, kind: 'ai', name: null, connected: false, graceDeadline: null, botControlled: false, isHost: false },
];

describe('SlotList', () => {
  it('host sees slot-kind dropdown on every seat except own', () => {
    render(<SlotList seats={seats} youSlotIndex={0} isHost={true} onSetSlot={() => {}} />);
    const dropdowns = screen.getAllByRole('combobox');
    expect(dropdowns).toHaveLength(2);
  });

  it('non-host sees seats read-only', () => {
    render(<SlotList seats={seats} youSlotIndex={1} isHost={false} onSetSlot={() => {}} />);
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('fires onSetSlot when host changes a slot', () => {
    const spy = vi.fn();
    render(<SlotList seats={seats} youSlotIndex={0} isHost={true} onSetSlot={spy} />);
    const first = screen.getAllByRole('combobox')[0]!;
    fireEvent.change(first, { target: { value: 'locked' } });
    expect(spy).toHaveBeenCalledWith(1, { kind: 'locked' });
  });
});
