'use client';

import Card from '@/components/Card';
import { Card as CardType, PlayerState } from '@/lib/game/types';

interface MobileOpponentStripProps {
  player: PlayerState;
  teamIndex: number | null;
  teamColor: string | null;
}

export default function MobileOpponentStrip({
  player,
  teamIndex,
  teamColor,
}: MobileOpponentStripProps) {
  const stockTop: CardType | null =
    player.stockPile.length > 0 ? player.stockPile[player.stockPile.length - 1] : null;

  return (
    <div
      className="relative rounded-lg px-2 py-1.5 flex items-center gap-2"
      style={{
        background: 'rgba(0, 0, 0, 0.35)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05)',
      }}
    >
      {teamColor && (
        <div
          className="absolute -top-0.5 left-2 right-2 h-0.5 rounded-full"
          style={{ background: teamColor }}
        />
      )}

      {/* Identity column */}
      <div className="flex flex-col justify-center min-w-0 shrink-0">
        <span className="text-[11px] font-semibold text-white truncate">{player.name}</span>
        <span className="text-[9px] text-white/60 uppercase tracking-wider">
          h:{player.hand.length} · s:{player.stockPile.length}
          {teamIndex !== null && ` · T${teamIndex + 1}`}
        </span>
      </div>

      {/* Stock top */}
      <div className="shrink-0">
        {stockTop ? (
          <Card card={stockTop} size="sm" stacked={player.stockPile.length} />
        ) : (
          <Card card={null} size="sm" label="—" />
        )}
      </div>

      {/* Discard piles (tops only) */}
      <div className="flex gap-1 ml-auto">
        {player.discardPiles.map((pile, i) => {
          const top = pile[pile.length - 1] ?? null;
          return (
            <div key={i} className="flex flex-col items-center gap-0.5">
              <Card card={top} size="sm" stacked={pile.length} />
              <span className="text-[8px] text-white/50 leading-none">{pile.length}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
