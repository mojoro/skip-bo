'use client';

import type { PublicGameConfig } from '@/lib/net/protocol';

interface RulesetInfoProps {
  open: boolean;
  onClose: () => void;
  config: PublicGameConfig;
  playerNames: string[];
}

export default function RulesetInfo({ open, onClose, config, playerNames }: RulesetInfoProps) {
  if (!open) return null;

  const partnership = config.partnership;
  const teamLabels =
    partnership?.teams.map((team) =>
      team.map((slotIndex) => playerNames[slotIndex] ?? `seat ${slotIndex + 1}`).join(' + '),
    ) ?? [];

  return (
    <div
      className="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-800 text-zinc-100 rounded-lg shadow-xl w-full max-w-sm p-6 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold">Current Ruleset</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white text-sm"
          >
            ✕
          </button>
        </div>

        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-zinc-400">Ruleset</dt>
          <dd className="font-mono">{config.ruleset}</dd>

          <dt className="text-zinc-400">Players</dt>
          <dd className="font-mono">{playerNames.length}</dd>

          <dt className="text-zinc-400">Hand size</dt>
          <dd className="font-mono">{config.handSize}</dd>

          <dt className="text-zinc-400">Stock pile size</dt>
          <dd className="font-mono">{config.stockPileSize}</dd>

          <dt className="text-zinc-400">Build direction</dt>
          <dd className="font-mono">
            {config.bidirectionalBuild ? 'bidirectional' : 'ascending only'}
          </dd>

          <dt className="text-zinc-400">Partnership</dt>
          <dd className="font-mono">{partnership?.enabled ? 'on' : 'off'}</dd>

          <dt className="text-zinc-400">First player</dt>
          <dd className="font-mono">
            {config.ruleset === 'official' ? 'seat 1 (youngest)' : 'highest top-stock'}
          </dd>
        </dl>

        {partnership?.enabled && (
          <div className="flex flex-col gap-1 text-sm border-t border-zinc-700 pt-3">
            <div className="text-xs uppercase text-zinc-400">Teams</div>
            <ul className="list-disc pl-5">
              {teamLabels.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
            <div className="text-xs uppercase text-zinc-400 mt-2">Partnership permissions</div>
            <ul className="text-xs text-zinc-300">
              <li>
                Play from partner stock:{' '}
                <span className="font-mono">
                  {partnership.allowPlayFromPartnerStock ? 'yes' : 'no'}
                </span>
              </li>
              <li>
                Play from partner discard:{' '}
                <span className="font-mono">
                  {partnership.allowPlayFromPartnerDiscard ? 'yes' : 'no'}
                </span>
              </li>
              <li>
                Discard onto partner pile:{' '}
                <span className="font-mono">
                  {partnership.allowDiscardToPartnerDiscard ? 'yes' : 'no'}
                </span>
              </li>
            </ul>
          </div>
        )}

      </div>
    </div>
  );
}
