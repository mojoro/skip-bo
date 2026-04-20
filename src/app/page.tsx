'use client';

import { useState, useEffect } from 'react';
import { Lobby } from '@/components/lobby/Lobby';
import SiteFooter from '@/components/SiteFooter';
import { useDisplayName } from '@/lib/net/useDisplayName';
import { gameApiBaseUrl } from '@/lib/net/endpoints';
import { randomUUID } from '@/lib/net/uuid';

function useSessionId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    let existing = localStorage.getItem('skipboSessionId');
    if (!existing) {
      existing = randomUUID();
      localStorage.setItem('skipboSessionId', existing);
    }
    setId(existing);
  }, []);
  return id;
}

export default function LandingPage() {
  const sessionId = useSessionId();
  const [name, setName] = useDisplayName();
  const [draft, setDraft] = useState('');

  const baseUrl = gameApiBaseUrl();

  const body = (() => {
    if (!sessionId) {
      return <LandingFrame><div className="text-center text-white/50 italic">Loading…</div></LandingFrame>;
    }
    if (!name) {
      return (
        <LandingFrame>
          <form
            onSubmit={(e) => { e.preventDefault(); const v = draft.trim(); if (v) setName(v); }}
            className="space-y-4 text-center"
          >
            <h1 className="text-2xl text-white">Pick a name</h1>
            <input
              autoFocus
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Your display name"
              className="bg-black/40 border border-white/15 rounded px-3 py-2 text-white text-sm"
            />
            <div>
              <button type="submit" className="bg-[var(--gold)] text-stone-900 font-semibold hover:brightness-110 px-4 py-2 rounded text-sm">
                Continue
              </button>
            </div>
          </form>
        </LandingFrame>
      );
    }
    return <Lobby baseUrl={baseUrl} sessionId={sessionId} displayName={name} onDisplayNameChange={setName} />;
  })();

  return (
    <>
      {body}
      <SiteFooter />
    </>
  );
}

function LandingFrame({ children }: { children: React.ReactNode }) {
  return (
    <main
      className="min-h-[100dvh] wood-frame flex items-center justify-center"
      style={{
        paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
        paddingRight: 'max(1.5rem, env(safe-area-inset-right))',
        paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
        paddingLeft: 'max(1.5rem, env(safe-area-inset-left))',
      }}
    >
      <div className="felt-surface rounded-xl p-8 max-w-md w-full">{children}</div>
    </main>
  );
}
