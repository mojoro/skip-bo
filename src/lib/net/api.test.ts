import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoom, joinRoom, findRoomByCode, ApiError } from './api';

const baseUrl = 'http://localhost:8787';

describe('api.createRoom', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });

  it('POSTs to /v1/rooms with bearer header and returns the roomId + code', async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response(
      JSON.stringify({ roomId: 'abc', code: 'GOLD-42' }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    ));
    const result = await createRoom({
      baseUrl,
      sessionId: 's-1',
      body: {
        playerName: 'Alice',
        config: { ruleset: 'recommended', stockPileSize: 10, handSize: 5, bidirectionalBuild: true, maxPlayers: 2, partnership: null },
        allowAiFill: false,
        visibility: 'public',
      },
    });
    expect(result).toEqual({ roomId: 'abc', code: 'GOLD-42' });
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe(`${baseUrl}/v1/rooms`);
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('Bearer s-1');
  });

  it('throws a typed ApiError for Problem+JSON 4xx response', async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response(
      JSON.stringify({ type: 'tag:skip-bo/full', title: 'Full', status: 409, detail: 'Room is full.' }),
      { status: 409, headers: { 'content-type': 'application/problem+json' } },
    ));
    await expect(joinRoom({ baseUrl, sessionId: 's-1', roomId: 'r', playerName: 'A' }))
      .rejects.toMatchObject({ status: 409, detail: 'Room is full.' });
  });
});

describe('api.findRoomByCode', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });

  it('returns the first matching room or null', async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response(
      JSON.stringify({ rooms: [{ id: 'r-1', code: 'GOLD-42' }], stats: {} }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    const room = await findRoomByCode({ baseUrl, code: 'GOLD-42' });
    expect(room).toMatchObject({ id: 'r-1' });
  });
});
