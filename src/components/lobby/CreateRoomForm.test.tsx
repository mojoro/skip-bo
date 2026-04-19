/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateRoomForm } from './CreateRoomForm';

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });

describe('CreateRoomForm', () => {
  it('opens the modal and calls onCreated with roomId after submit', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ roomId: 'r-new', code: 'GOLD-42' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const spy = vi.fn();
    render(
      <CreateRoomForm
        baseUrl="http://localhost:8787"
        sessionId="s-1"
        playerName="Alice"
        onCreated={spy}
      />,
    );

    // Click "Create room" button (aria-label: "open settings") to open the modal
    fireEvent.click(screen.getByRole('button', { name: /open settings/i }));

    // Modal should now be open — click "Start Game" to submit
    const startBtn = await screen.findByRole('button', { name: /start game/i });
    fireEvent.click(startBtn);

    await waitFor(() => expect(spy).toHaveBeenCalledWith('r-new'));
  });
});
