/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDisplayName } from './useDisplayName';

describe('useDisplayName', () => {
  beforeEach(() => localStorage.clear());

  it('returns null on first render before the mount effect runs', () => {
    const { result } = renderHook(() => useDisplayName());
    expect(result.current[0]).toBeNull();
  });

  it('reads from localStorage after mount', () => {
    localStorage.setItem('skipboDisplayName', 'Alice');
    const { result } = renderHook(() => useDisplayName());
    expect(result.current[0]).toBe('Alice');
  });

  it('setName writes through to localStorage', () => {
    const { result } = renderHook(() => useDisplayName());
    act(() => result.current[1]('Bob'));
    expect(localStorage.getItem('skipboDisplayName')).toBe('Bob');
    expect(result.current[0]).toBe('Bob');
  });
});
