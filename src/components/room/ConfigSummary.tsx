'use client';

import type { PublicGameConfig } from '@/lib/net/protocol';

export interface ConfigSummaryProps {
  config: PublicGameConfig;
  isHost: boolean;
  onEdit: () => void;
}

export function ConfigSummary({ config, isHost, onEdit }: ConfigSummaryProps) {
  const items: Array<[string, string]> = [
    ['Ruleset', config.ruleset],
    ['Stock size', String(config.stockPileSize)],
    ['Hand size', String(config.handSize)],
    ['Bidirectional build', config.bidirectionalBuild ? 'on' : 'off'],
    ['Max players', String(config.maxPlayers)],
  ];

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wider text-white/70 font-semibold">Configuration</h3>
        {isHost && (
          <button type="button" onClick={onEdit}
            className="text-xs text-[var(--gold)] underline decoration-dotted hover:brightness-110">
            Edit
          </button>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-y-1 text-xs text-white/80">
        {items.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-white/50">{label}</dt>
            <dd className="text-right">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
