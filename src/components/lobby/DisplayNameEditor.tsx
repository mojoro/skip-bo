'use client';

import { useState, useRef, useEffect } from 'react';

export interface DisplayNameEditorProps {
  name: string;
  onChange: (next: string) => void;
}

export function DisplayNameEditor({ name, onChange }: DisplayNameEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  useEffect(() => { setDraft(name); }, [name]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) onChange(trimmed);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className="bg-black/40 border border-white/15 rounded px-2 py-1 text-xs text-white"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="text-xs text-white/80 underline decoration-dotted hover:text-white"
    >
      {name}
    </button>
  );
}
