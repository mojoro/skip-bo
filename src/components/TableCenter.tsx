'use client';

import Card from '@/components/Card';
import DroppableZone from '@/components/DroppableZone';
import { BuildPile, GameConfig } from '@/lib/game/types';

interface TableCenterProps {
  buildPiles: BuildPile[];
  drawPileCount: number;
  completedPileCount: number;
  config: GameConfig;
  onClickBuildPile: (index: number) => void;
}

export default function TableCenter({
  buildPiles,
  drawPileCount,
  completedPileCount,
  config,
  onClickBuildPile,
}: TableCenterProps) {
  const emptyLabel = config.bidirectionalBuild ? 'START 1 / 12 / WILD' : 'START 1 / WILD';

  return (
    <div
      className="md:absolute md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 mx-auto w-fit rounded-2xl px-4 py-4 sm:px-8 sm:py-6 table-inset"
      style={{
        background:
          'radial-gradient(circle at 50% 35%, rgba(255,255,255,0.08), rgba(0,0,0,0.25))',
        boxShadow:
          'inset 0 0 40px rgba(0,0,0,0.6), 0 10px 30px rgba(0,0,0,0.45)',
      }}
    >
      <div className="flex items-center gap-2 sm:gap-6 flex-wrap justify-center">
        {/* Draw pile */}
        <div className="flex flex-col items-center gap-1">
          {drawPileCount > 0 ? (
            <Card card={null} faceDown size="md" stacked={Math.min(drawPileCount, 4)} />
          ) : (
            <Card card={null} size="md" label="empty" />
          )}
          <span className="text-[10px] text-white/80 tracking-widest font-semibold">
            DRAW · {drawPileCount}
          </span>
        </div>

        {/* Build piles */}
        <div className="flex items-center gap-2 sm:gap-3">
          {buildPiles.map((pile, i) => {
            const top = pile.cards[pile.cards.length - 1] ?? null;
            const sub = pile.cards.length === 0
              ? emptyLabel
              : `${pile.direction?.toUpperCase()} · ${pile.cards.length}/12`;
            return (
              <DroppableZone
                key={i}
                id={`build-${i}`}
                data={{ kind: 'build', index: i }}
                className="flex flex-col items-center gap-1"
              >
                <Card
                  card={top}
                  size="md"
                  stacked={pile.cards.length}
                  onClick={() => onClickBuildPile(i)}
                />
                <span className="text-[9px] sm:text-[10px] text-white/75 tracking-wider text-center leading-tight w-16 sm:w-auto">
                  {sub}
                </span>
              </DroppableZone>
            );
          })}
        </div>

        {/* Completed piles */}
        <div className="flex flex-col items-center gap-1 opacity-80">
          {completedPileCount > 0 ? (
            <div
              className="w-16 h-24 rounded-md border border-white/20 flex items-center justify-center text-white/70 text-xs font-semibold"
              style={{
                background:
                  'linear-gradient(160deg, rgba(255,255,255,0.05), rgba(0,0,0,0.35))',
              }}
            >
              {completedPileCount}
            </div>
          ) : (
            <Card card={null} size="md" />
          )}
          <span className="text-[10px] text-white/60 tracking-widest">
            COMPLETED
          </span>
        </div>
      </div>
    </div>
  );
}
