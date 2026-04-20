'use client';

import { useRef, useState } from 'react';
import type { ChatEntry } from '@/lib/net/protocol';

export interface ChatPanelProps {
  chat: ChatEntry[];
  onSend: (text: string) => void;
}

export function ChatPanel({ chat, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setDraft('');
  };

  // iOS Safari (and some Android browsers) only scroll a focused input above
  // the virtual keyboard once the input's value changes, not on focus itself.
  // We poll scrollIntoView across the keyboard's animation window so the
  // composer lifts the moment the keyboard opens.
  const handleFocus = () => {
    const node = inputRef.current;
    if (!node) return;
    const start = performance.now();
    const DURATION_MS = 500;
    const tick = () => {
      node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (performance.now() - start < DURATION_MS) {
        window.requestAnimationFrame(tick);
      }
    };
    tick();
  };

  return (
    <div className="flex flex-col h-60 rounded-xl border border-white/10 bg-black/30">
      <ol className="flex-1 overflow-y-auto px-3 py-2 space-y-1 text-xs text-white/85">
        {chat.map((c, i) => (
          <li key={i}>
            <span className="text-white/50">{c.fromName}:</span> {c.text}
          </li>
        ))}
        {chat.length === 0 && <li className="text-white/40 italic">No messages yet</li>}
      </ol>
      <form onSubmit={submit} className="border-t border-white/10 p-2 flex gap-2">
        <input
          ref={inputRef}
          type="text"
          placeholder="Type a message…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={handleFocus}
          className="flex-1 bg-black/40 border border-white/15 rounded px-2 py-1 text-xs text-white"
          maxLength={200}
        />
        <button type="submit" className="bg-[var(--gold)] text-stone-900 font-semibold hover:brightness-110 px-2 py-1 rounded text-xs">
          Send
        </button>
      </form>
    </div>
  );
}
