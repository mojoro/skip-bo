'use client';

import { useState } from 'react';
import type { ChatEntry } from '@/lib/net/protocol';

export interface ChatPanelProps {
  chat: ChatEntry[];
  onSend: (text: string) => void;
}

export function ChatPanel({ chat, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setDraft('');
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
          type="text"
          placeholder="Type a message…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
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
