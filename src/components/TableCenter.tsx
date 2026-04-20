'use client';

import Card from '@/components/Card';
import DroppableZone from '@/components/DroppableZone';
import WildDirectionPicker from '@/components/WildDirectionPicker';
import { BuildPile, CardValue, WILD } from '@/lib/game/types';

// Top of an asc pile at length N represents N; a desc pile represents 13-N.
// Used so the Card can display "what this wild is standing in for".
function topWildValueForPile(pile: BuildPile): CardValue | undefined {
  if (pile.cards.length === 0) return undefined;
  const top = pile.cards[pile.cards.length - 1];
  if (!top || top.value !== WILD) return undefined;
  if (pile.direction === 'asc') return pile.cards.length as CardValue;
  if (pile.direction === 'desc') return (13 - pile.cards.length) as CardValue;
  return undefined;
}

interface TableCenterProps {
  buildPiles: BuildPile[];
  drawPileCount: number;
  completedPileCount: number;
  config: { bidirectionalBuild: boolean };
  onClickBuildPile: (index: number) => void;
  pendingWildBuildPileIndex?: number | null;
  onPickWildDirection?: (direction: 'asc' | 'desc') => void;
  onCancelWildPlay?: () => void;
}

export default function TableCenter({
  buildPiles,
  drawPileCount,
  completedPileCount,
  config,
  onClickBuildPile,
  pendingWildBuildPileIndex,
  onPickWildDirection,
  onCancelWildPlay,
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
        <div className="flex flex-col items-center gap-1" data-tour="draw">
          {drawPileCount > 0 ? (
            <Card card={null} faceDown size="md" stacked={Math.min(drawPileCount, 4)} />
          ) : (
            <Card card={null} size="md" label="empty" />
          )}
          <span className="text-[10px] text-white/80 tracking-widest font-semibold tabular-nums">
            DRAW · {drawPileCount}
          </span>
        </div>

        {/* Build piles */}
        <div className="flex items-center gap-2 sm:gap-3" data-tour="build">
          {buildPiles.map((pile, i) => {
            const top = pile.cards[pile.cards.length - 1] ?? null;
            const isPendingWild = pendingWildBuildPileIndex === i;
            return (
              <DroppableZone
                key={i}
                id={`build-${i}`}
                data={{ kind: 'build', index: i }}
                className="flex flex-col items-center gap-1"
              >
                {isPendingWild && onPickWildDirection && onCancelWildPlay ? (
                  <WildDirectionPicker
                    size="md"
                    onPickAsc={() => onPickWildDirection('asc')}
                    onPickDesc={() => onPickWildDirection('desc')}
                    onCancel={onCancelWildPlay}
                  />
                ) : (
                  <Card
                    card={top}
                    size="md"
                    stacked={pile.cards.length}
                    asValue={topWildValueForPile(pile)}
                    buildDirection={pile.direction ?? undefined}
                    onClick={() => onClickBuildPile(i)}
                  />
                )}
                {isPendingWild ? (
                  <span className="text-[9px] sm:text-[10px] text-white/75 tracking-wider text-center leading-tight w-16 sm:w-auto">
                    pick direction
                  </span>
                ) : pile.cards.length === 0 ? (
                  <span className="text-[9px] sm:text-[10px] text-white/75 tracking-wider text-center leading-tight w-16 sm:w-auto">
                    {emptyLabel}
                  </span>
                ) : null}
              </DroppableZone>
            );
          })}
        </div>

        {/* Completed piles */}
        <div className="flex flex-col items-center gap-1 opacity-80">
          {completedPileCount > 0 ? (
            <div
              className="w-16 h-24 rounded-md border border-white/20 flex items-center justify-center text-white/70 text-xs font-semibold tabular-nums"
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
