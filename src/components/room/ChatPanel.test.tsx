/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatPanel } from './ChatPanel';

describe('ChatPanel', () => {
  it('renders messages in order', () => {
    render(<ChatPanel
      chat={[
        { fromSlotIndex: 0, fromName: 'Alice', text: 'hi', sentAt: 1 },
        { fromSlotIndex: 1, fromName: 'Bob', text: 'hey', sentAt: 2 },
      ]}
      onSend={() => {}}
    />);
    expect(screen.getByText('hi')).toBeInTheDocument();
    expect(screen.getByText('hey')).toBeInTheDocument();
  });

  it('submits non-empty input and clears the field', () => {
    const spy = vi.fn();
    render(<ChatPanel chat={[]} onSend={spy} />);
    const input = screen.getByPlaceholderText(/type a message/i);
    fireEvent.change(input, { target: { value: '  hello  ' } });
    fireEvent.submit(input.closest('form')!);
    expect(spy).toHaveBeenCalledWith('hello');
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('ignores empty submits', () => {
    const spy = vi.fn();
    render(<ChatPanel chat={[]} onSend={spy} />);
    fireEvent.submit(screen.getByPlaceholderText(/type a message/i).closest('form')!);
    expect(spy).not.toHaveBeenCalled();
  });
});
