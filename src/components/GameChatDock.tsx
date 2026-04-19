'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChatEntry } from '@/lib/net/protocol';

interface GameChatDockProps {
  chat: ChatEntry[];
  onSend: (text: string) => void;
}

export default function GameChatDock({ chat, onSend }: GameChatDockProps) {
  const [open, setOpen] = useState(false);
  const [lastSeen, setLastSeen] = useState(chat.length);
  const [draft, setDraft] = useState('');
  // Extra bottom offset to keep the dock above the virtual keyboard on
  // browsers that don't honor viewport `interactiveWidget: resizes-content`
  // (older iOS Safari). Chrome/Android and iOS 17.4+ shrink the layout
  // viewport themselves and this stays at 0.
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const listRef = useRef<HTMLOListElement | null>(null);

  // Keep the read marker pinned to the tail while the panel is open so
  // freshly-arriving messages don't flash the unread badge under the user's
  // nose.
  useEffect(() => {
    if (open) setLastSeen(chat.length);
  }, [open, chat.length]);

  // Auto-scroll the panel to the newest message whenever chat grows.
  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [chat.length, open]);

  // Track the visual viewport so the dock floats above the virtual keyboard
  // even when the browser doesn't resize the layout viewport.
  useEffect(() => {
    if (!open) { setKeyboardOffset(0); return; }
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    const measure = () => {
      const layoutHeight = window.innerHeight;
      const hidden = Math.max(0, layoutHeight - vv.height - vv.offsetTop);
      setKeyboardOffset(hidden);
    };
    measure();
    vv.addEventListener('resize', measure);
    vv.addEventListener('scroll', measure);
    return () => {
      vv.removeEventListener('resize', measure);
      vv.removeEventListener('scroll', measure);
    };
  }, [open]);

  const unread = Math.max(0, chat.length - lastSeen);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setDraft('');
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={unread > 0 ? `Open chat (${unread} new)` : 'Open chat'}
        className="fixed z-40 w-11 h-11 rounded-full bg-black/55 hover:bg-black/75 border border-white/15 text-white flex items-center justify-center shadow-lg backdrop-blur-sm"
        style={{
          bottom: 'max(0.75rem, env(safe-area-inset-bottom))',
          left: 'max(0.75rem, env(safe-area-inset-left))',
        }}
      >
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-black/70">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      className="fixed z-40 w-80 max-w-[92vw] rounded-xl overflow-hidden border border-white/15 bg-black/55 backdrop-blur-sm shadow-2xl flex flex-col"
      style={{
        bottom: `calc(max(0.75rem, env(safe-area-inset-bottom)) + ${keyboardOffset}px)`,
        left: 'max(0.75rem, env(safe-area-inset-left))',
      }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <span className="text-xs font-semibold text-white/85 tracking-wider uppercase">
          Chat
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close chat"
          className="text-white/60 hover:text-white text-sm leading-none px-1"
        >
          ✕
        </button>
      </div>

      <ol
        ref={listRef}
        className="h-48 overflow-y-auto px-3 py-2 space-y-1 text-xs text-white/85"
      >
        {chat.length === 0 && (
          <li className="text-white/40 italic">No messages yet</li>
        )}
        {chat.map((c, i) => (
          <li key={i}>
            <span className="text-white/50">{c.fromName}:</span> {c.text}
          </li>
        ))}
      </ol>

      <form onSubmit={submit} className="border-t border-white/10 p-2 flex gap-2">
        <input
          type="text"
          placeholder="Type a message…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={200}
          enterKeyHint="send"
          autoComplete="off"
          autoCorrect="off"
          className="flex-1 bg-black/40 border border-white/15 rounded px-2 py-1 text-xs text-white"
        />
        <button
          type="submit"
          className="bg-[var(--gold)] text-stone-900 font-semibold hover:brightness-110 px-2 py-1 rounded text-xs"
        >
          Send
        </button>
      </form>
    </div>
  );
}
