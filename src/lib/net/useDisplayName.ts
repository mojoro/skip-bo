'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'skipboDisplayName';

export function useDisplayName(): [string | null, (next: string) => void] {
  const [name, setNameState] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) setNameState(stored);
  }, []);

  const setName = useCallback((next: string) => {
    const trimmed = next.trim();
    if (trimmed.length === 0) return;
    localStorage.setItem(STORAGE_KEY, trimmed);
    setNameState(trimmed);
  }, []);

  return [name, setName];
}
