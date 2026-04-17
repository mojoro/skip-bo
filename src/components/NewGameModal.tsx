'use client';

import { useEffect, useState } from 'react';
import {
  CONFIG_LIMITS,
  GameConfig,
  PartnershipRules,
  Ruleset,
  defaultConfigForRuleset,
  defaultPartnershipRules,
} from '@/lib/game/types';

export interface NewGameSettings {
  ruleset: Ruleset;
  playerCount: number;
  handSize: number;
  stockPileSize: number;
  bidirectionalBuild: boolean;
  partnershipEnabled: boolean;
  partnershipAllowDiscardToPartner: boolean;
}

interface NewGameModalProps {
  open: boolean;
  onCancel: () => void;
  onStart: (settings: NewGameSettings) => void;
  defaultPlayerCount?: number;
}

function rulesetDefaults(ruleset: Ruleset, playerCount: number): NewGameSettings {
  const base = defaultConfigForRuleset(ruleset, playerCount);
  const canPartner = playerCount >= 4 && playerCount % 2 === 0;
  return {
    ruleset,
    playerCount,
    handSize: base.handSize,
    stockPileSize: base.stockPileSize,
    bidirectionalBuild: base.bidirectionalBuild,
    partnershipEnabled: false,
    partnershipAllowDiscardToPartner: ruleset === 'recommended' && canPartner,
  };
}

export default function NewGameModal({
  open,
  onCancel,
  onStart,
  defaultPlayerCount = 2,
}: NewGameModalProps) {
  const [settings, setSettings] = useState<NewGameSettings>(() =>
    rulesetDefaults('recommended', defaultPlayerCount),
  );

  useEffect(() => {
    if (open) setSettings(rulesetDefaults('recommended', defaultPlayerCount));
  }, [open, defaultPlayerCount]);

  if (!open) return null;

  const canPartner = settings.playerCount >= 4 && settings.playerCount % 2 === 0;

  const pickRuleset = (ruleset: Ruleset) => {
    setSettings((s) => ({
      ...rulesetDefaults(ruleset, s.playerCount),
      partnershipEnabled: s.partnershipEnabled && canPartner,
    }));
  };

  const setPlayerCount = (n: number) => {
    setSettings((s) => {
      const newCanPartner = n >= 4 && n % 2 === 0;
      return {
        ...s,
        playerCount: n,
        partnershipEnabled: s.partnershipEnabled && newCanPartner,
        partnershipAllowDiscardToPartner:
          s.ruleset === 'recommended' && newCanPartner
            ? s.partnershipAllowDiscardToPartner
            : false,
      };
    });
  };

  const clamp = (n: number, key: 'handSize' | 'stockPileSize') => {
    const l = CONFIG_LIMITS[key];
    return Math.min(l.max, Math.max(l.min, Math.round(n || 0)));
  };

  return (
    <div
      className="fixed inset-0 bg-black/70 z-40 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-zinc-800 text-zinc-100 rounded-lg shadow-xl w-full max-w-md p-6 flex flex-col gap-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold">New Game</h2>

        {/* Ruleset */}
        <section className="flex flex-col gap-2">
          <label className="text-xs uppercase text-zinc-400">Ruleset</label>
          <div className="flex gap-2">
            {(['recommended', 'official'] as const).map((r) => (
              <button
                key={r}
                onClick={() => pickRuleset(r)}
                className={`flex-1 px-3 py-2 rounded border ${
                  settings.ruleset === r
                    ? 'bg-yellow-500 text-zinc-900 border-yellow-400 font-semibold'
                    : 'bg-zinc-700 border-zinc-600 hover:bg-zinc-600'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-400">
            {settings.ruleset === 'recommended'
              ? 'Bidirectional build piles (start 1 or 12), stock 15. Highest top-stock card goes first (ties coin-flipped).'
              : 'Official Mattel rules. Ascending only. Stock size scales with player count. Seat 1 goes first (arrange by age: youngest first).'}
          </p>
        </section>

        {/* Players */}
        <section className="flex flex-col gap-2">
          <label className="text-xs uppercase text-zinc-400">Players</label>
          <div className="flex gap-1 flex-wrap">
            {[2, 3, 4, 5, 6, 7, 8].map((n) => (
              <button
                key={n}
                onClick={() => setPlayerCount(n)}
                className={`w-10 h-10 rounded ${
                  settings.playerCount === n
                    ? 'bg-yellow-500 text-zinc-900 font-semibold'
                    : 'bg-zinc-700 hover:bg-zinc-600'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </section>

        {/* Hand + stock sliders */}
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex justify-between items-center">
              <label className="text-xs uppercase text-zinc-400">Hand size</label>
              <span className="text-sm font-mono">{settings.handSize}</span>
            </div>
            <input
              type="range"
              min={CONFIG_LIMITS.handSize.min}
              max={CONFIG_LIMITS.handSize.max}
              value={settings.handSize}
              onChange={(e) =>
                setSettings((s) => ({ ...s, handSize: clamp(+e.target.value, 'handSize') }))
              }
            />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex justify-between items-center">
              <label className="text-xs uppercase text-zinc-400">Stock pile size</label>
              <span className="text-sm font-mono">{settings.stockPileSize}</span>
            </div>
            <input
              type="range"
              min={CONFIG_LIMITS.stockPileSize.min}
              max={CONFIG_LIMITS.stockPileSize.max}
              value={settings.stockPileSize}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  stockPileSize: clamp(+e.target.value, 'stockPileSize'),
                }))
              }
            />
          </div>
        </section>

        {/* Bidirectional */}
        <section>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={settings.bidirectionalBuild}
              onChange={(e) =>
                setSettings((s) => ({ ...s, bidirectionalBuild: e.target.checked }))
              }
            />
            Bidirectional build piles (start at 1 or 12)
          </label>
        </section>

        {/* Partnership */}
        <section className="flex flex-col gap-2 border-t border-zinc-700 pt-4">
          <label
            className={`flex items-center gap-2 text-sm ${
              canPartner ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'
            }`}
          >
            <input
              type="checkbox"
              disabled={!canPartner}
              checked={settings.partnershipEnabled && canPartner}
              onChange={(e) =>
                setSettings((s) => ({ ...s, partnershipEnabled: e.target.checked }))
              }
            />
            Partnership mode
            {!canPartner && (
              <span className="text-xs text-zinc-500">(even count ≥ 4 required)</span>
            )}
          </label>
          {settings.partnershipEnabled && canPartner && (
            <div className="ml-6 flex flex-col gap-1 text-xs text-zinc-400">
              <div>
                Teams auto-paired opposite (e.g., {settings.playerCount === 4 ? 'P1+P3, P2+P4' : 'opposite seats'}).
              </div>
              <label className="flex items-center gap-2 cursor-pointer mt-1 text-zinc-200 text-sm">
                <input
                  type="checkbox"
                  checked={settings.partnershipAllowDiscardToPartner}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      partnershipAllowDiscardToPartner: e.target.checked,
                    }))
                  }
                />
                Allow discarding onto partner's pile
              </label>
            </div>
          )}
        </section>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded bg-zinc-700 hover:bg-zinc-600"
          >
            Cancel
          </button>
          <button
            onClick={() => onStart(settings)}
            className="px-4 py-2 rounded bg-yellow-500 text-zinc-900 font-semibold hover:bg-yellow-400"
          >
            Start Game
          </button>
        </div>
      </div>
    </div>
  );
}

export function buildPartnershipFromSettings(
  settings: NewGameSettings,
  playerIds: string[],
): PartnershipRules | null {
  if (!settings.partnershipEnabled) return null;
  if (playerIds.length % 2 !== 0 || playerIds.length < 4) return null;
  const half = playerIds.length / 2;
  const teams: string[][] = [];
  for (let i = 0; i < half; i++) {
    teams.push([playerIds[i], playerIds[i + half]]);
  }
  return {
    ...defaultPartnershipRules(settings.ruleset, teams),
    allowDiscardToPartnerDiscard: settings.partnershipAllowDiscardToPartner,
  };
}

export function settingsToConfigOverrides(settings: NewGameSettings): Partial<GameConfig> {
  return {
    handSize: settings.handSize,
    stockPileSize: settings.stockPileSize,
    bidirectionalBuild: settings.bidirectionalBuild,
  };
}
