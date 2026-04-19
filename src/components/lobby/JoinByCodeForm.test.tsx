/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { JoinByCodeForm } from './JoinByCodeForm';

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });

describe('JoinByCodeForm', () => {
  it('finds room by code, joins, calls onJoined', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ rooms: [{ id: 'r-9', code: 'GOLD42' }], stats: {} }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ slotIndex: 1, room: { id: 'r-9' } }), { status: 201, headers: { 'content-type': 'application/json' } }));
    const spy = vi.fn();
    render(<JoinByCodeForm baseUrl="http://localhost:8787" sessionId="s-1" playerName="Alice" onJoined={spy} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'gold42  ' } });
    fireEvent.click(screen.getByRole('button', { name: /join/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('r-9'));
    expect(fetchMock.mock.calls[0][0]).toContain('code=GOLD42');
  });

  it('surfaces "No room with that code" when room not found', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ rooms: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    render(<JoinByCodeForm baseUrl="http://localhost:8787" sessionId="s-1" playerName="Alice" onJoined={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'bogus' } });
    fireEvent.click(screen.getByRole('button', { name: /join/i }));
    expect(await screen.findByText(/no room with that code/i)).toBeInTheDocument();
  });
});
