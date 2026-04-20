'use client';

import { useEffect } from 'react';

interface WildDirectionPickerProps {
  size?: 'md' | 'lg';
  onPickAsc: () => void;
  onPickDesc: () => void;
  onCancel: () => void;
}

const SIZE_CLASSES: Record<'md' | 'lg', string> = {
  md: 'w-16 h-24',
  lg: 'w-20 h-28',
};

export default function WildDirectionPicker({
  size = 'md',
  onPickAsc,
  onPickDesc,
  onCancel,
}: WildDirectionPickerProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      className={`${SIZE_CLASSES[size]} rounded-md overflow-hidden flex flex-col border border-[var(--gold)] shadow-[0_0_14px_rgba(217,164,65,0.55)]`}
    >
      <button
        onClick={onPickAsc}
        className="flex-1 flex flex-col items-center justify-center gap-0.5 bg-gradient-to-b from-emerald-600 to-emerald-800 text-white hover:brightness-110 active:scale-[0.96] transition-transform"
        aria-label="Start ascending at 1"
      >
        <span className="text-lg leading-none">↑</span>
        <span className="text-[10px] font-bold tracking-widest">ASC · 1</span>
      </button>
      <div className="h-px bg-black/40" />
      <button
        onClick={onPickDesc}
        className="flex-1 flex flex-col items-center justify-center gap-0.5 bg-gradient-to-b from-rose-600 to-rose-800 text-white hover:brightness-110 active:scale-[0.96] transition-transform"
        aria-label="Start descending at 12"
      >
        <span className="text-lg leading-none">↓</span>
        <span className="text-[10px] font-bold tracking-widest">DESC · 12</span>
      </button>
    </div>
  );
}
