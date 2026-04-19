'use client';

import Card from '@/components/Card';
import type { SeatViewModel } from '@/lib/view/seat';

export interface MobileOpponentStripProps {
  seat: SeatViewModel;
}

export default function MobileOpponentStrip({ seat }: MobileOpponentStripProps) {
  return (
    <div
      className="relative rounded-lg px-2 py-1.5 flex items-center gap-2"
      style={{
        background: 'rgba(0, 0, 0, 0.35)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05)',
      }}
    >
      {seat.team && (
        <div
          className="absolute -top-0.5 left-2 right-2 h-0.5 rounded-full"
          style={{ background: seat.team.color }}
        />
      )}

      <div className="flex flex-col justify-center min-w-0 shrink-0">
        <span className="text-[11px] font-semibold text-white truncate">{seat.name}</span>
        <span className="text-[9px] text-white/60 uppercase tracking-wider">
          h:{seat.handCount} · s:{seat.stockCount}
          {seat.team !== null && ` · T${seat.team.index + 1}`}
          {seat.isHost && ' · host'}
        </span>
      </div>

      <div className="shrink-0">
        {seat.stockTop ? (
          <Card card={seat.stockTop} size="sm" stacked={seat.stockCount} />
        ) : (
          <Card card={null} size="sm" label="—" />
        )}
      </div>

      <div className="flex gap-1 ml-auto">
        {seat.discardPiles.map((pile, i) => {
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
