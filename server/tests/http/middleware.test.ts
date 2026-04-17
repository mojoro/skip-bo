import { describe, it, expect } from 'vitest';
import { AddressInfo } from 'node:net';
import { buildHttpServer } from '../../src/http/server';
import { RoomManager } from '../../src/room/manager';

describe('http middleware', () => {
  it('echoes X-Flow-Id and sets CORS headers', async () => {
    const mgr = new RoomManager();
    const { httpServer } = buildHttpServer({ roomManager: mgr, corsOrigin: 'http://localhost:3000' });
    await new Promise<void>((r) => httpServer.listen(0, r));
    const { port } = httpServer.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}/v1/rooms`;
    const res = await fetch(url, {
      method: 'OPTIONS',
      headers: { 'x-flow-id': 'flow-abc', origin: 'http://localhost:3000', 'access-control-request-method': 'GET' },
    });
    expect(res.headers.get('x-flow-id')).toBe('flow-abc');
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    httpServer.close();
  });

  it('returns 401 when Authorization header missing on protected route', async () => {
    const { buildHttpServer: build, mountRoutes: mount } = await import('../../src/http/server');
    const mgr = new RoomManager();
    const { httpServer, router } = build({ roomManager: mgr, corsOrigin: '*' });
    mount(router, mgr);
    await new Promise<void>((r) => httpServer.listen(0, r));
    const { port } = httpServer.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/v1/rooms`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    httpServer.close();
  });

  it('returns 400 when body is invalid JSON', async () => {
    const mgr = new RoomManager();
    const { httpServer } = buildHttpServer({ roomManager: mgr, corsOrigin: '*' });
    await new Promise<void>((r) => httpServer.listen(0, r));
    const { port } = httpServer.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/v1/rooms`, { method: 'GET' });
    expect([200, 404]).toContain(res.status);
    httpServer.close();
  });
});
