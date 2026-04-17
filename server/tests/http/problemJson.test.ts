import { describe, it, expect } from 'vitest';
import { problemResponse, type Problem } from '../../src/problemJson';

describe('problemJson', () => {
  it('formats a standard problem', () => {
    const res = problemResponse({
      type: 'https://api.example.com/problems/room-full',
      title: 'Room is full',
      status: 409,
      detail: 'No open slots',
      instance: '/v1/rooms/abc/members',
    });
    expect(res.statusCode).toBe(409);
    expect(res.headers['content-type']).toBe('application/problem+json');
    const body = JSON.parse(res.body) as Problem;
    expect(body.status).toBe(409);
    expect(body.title).toBe('Room is full');
  });
});
