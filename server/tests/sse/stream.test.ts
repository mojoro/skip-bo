import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../../src/sse/ringBuffer';

describe('RingBuffer', () => {
  it('since(id) returns events after the given id', () => {
    const rb = new RingBuffer<string>(5);
    rb.push('a'); rb.push('b'); rb.push('c');
    expect(rb.since(1)).toEqual([{ id: 2, value: 'b' }, { id: 3, value: 'c' }]);
  });

  it('since(id) returns null when id is older than the ring', () => {
    const rb = new RingBuffer<string>(2);
    rb.push('a'); rb.push('b'); rb.push('c');
    expect(rb.since(1)).toBe(null);
  });

  it('since with empty buffer returns []', () => {
    const rb = new RingBuffer<string>(3);
    expect(rb.since(0)).toEqual([]);
  });
});
