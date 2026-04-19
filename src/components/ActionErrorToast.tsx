'use client';

import { useEffect, useState } from 'react';

interface ActionErrorToastProps {
  // Set to a new object (not the same reference) each time a rejection
  // arrives, including consecutive rejections with the same reason — the
  // reference change is what retriggers the visible window.
  error: { reason: string } | null;
  durationMs?: number;
}

export default function ActionErrorToast({
  error,
  durationMs = 3000,
}: ActionErrorToastProps) {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!error) return;
    setMessage(error.reason);
    const t = setTimeout(() => setMessage(null), durationMs);
    return () => clearTimeout(t);
  }, [error, durationMs]);

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-14 sm:top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg text-sm text-rose-100 bg-rose-900/95 ring-1 ring-rose-600/70 shadow-xl backdrop-blur-sm pointer-events-none whitespace-nowrap max-w-[92vw] overflow-hidden text-ellipsis"
    >
      <strong className="font-semibold">Action rejected:</strong> {message}
    </div>
  );
}
