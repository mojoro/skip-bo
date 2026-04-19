/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DisplayNameEditor } from './DisplayNameEditor';

describe('DisplayNameEditor', () => {
  it('renders current name and calls onChange with the new value', () => {
    const spy = vi.fn();
    render(<DisplayNameEditor name="Alice" onChange={spy} />);
    fireEvent.click(screen.getByText('Alice'));
    const input = screen.getByDisplayValue('Alice');
    fireEvent.change(input, { target: { value: 'Bob' } });
    fireEvent.blur(input);
    expect(spy).toHaveBeenCalledWith('Bob');
  });
});
