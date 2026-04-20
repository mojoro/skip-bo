'use client';

import { Card as CardType, CardValue, WILD } from '@/lib/game/types';

interface CardProps {
  card: CardType | null;
  faceDown?: boolean;
  size?: 'sm' | 'md' | 'lg';
  highlighted?: boolean;
  dim?: boolean;
  onClick?: () => void;
  label?: string;
  stacked?: number; // draws a slight stack effect (number of cards below)
  // When the card is a wildcard that has been played to a build pile, the
  // consuming component passes the number this wild is acting as — the card
  // then renders that number prominently with a small "SB" badge so players
  // can read the pile's value at a glance without counting cards.
  asValue?: CardValue;
  // When the card is the top of a build pile, the consuming component passes
  // the pile's direction so the card renders a small chevron in its top-right
  // corner indicating which way the pile is climbing.
  buildDirection?: 'asc' | 'desc';
}

// Inline chevron for build-pile direction. White so it reads on every card
// palette without extra theming.
function DirectionChevron({ direction, size }: { direction: 'asc' | 'desc'; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 16"
      aria-hidden
      style={{ transform: direction === 'asc' ? undefined : 'rotate(180deg)' }}
    >
      <path
        d="M7 1.2 L13 7.6 L9.6 7.6 L9.6 14.8 L4.4 14.8 L4.4 7.6 L1 7.6 Z"
        fill="#ffffff"
        stroke="rgba(0,0,0,0.55)"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type CardPalette = 'blue' | 'green' | 'red' | 'wild';

function paletteFor(value: CardValue): CardPalette {
  if (value === WILD) return 'wild';
  if (value <= 4) return 'blue';
  if (value <= 8) return 'green';
  return 'red';
}

const PALETTE_STYLES: Record<CardPalette, { bg: string; text: string; accent: string }> = {
  blue: {
    bg: 'linear-gradient(160deg, var(--card-blue-a), var(--card-blue-b))',
    text: '#ffffff',
    accent: 'rgba(255,255,255,0.35)',
  },
  green: {
    bg: 'linear-gradient(160deg, var(--card-green-a), var(--card-green-b))',
    text: '#ffffff',
    accent: 'rgba(255,255,255,0.35)',
  },
  red: {
    bg: 'linear-gradient(160deg, var(--card-red-a), var(--card-red-b))',
    text: '#ffffff',
    accent: 'rgba(255,255,255,0.3)',
  },
  // Sunny yellow-to-burnt-orange — the wild now reads as a warm, distinct
  // "Skip-Bo" face that stands out against any numbered suit.
  wild: {
    bg: 'radial-gradient(circle at 30% 20%, #fde68a, var(--card-wild-a) 45%, var(--card-wild-b) 100%)',
    text: '#3d1a04',
    accent: 'var(--card-wild-accent)',
  },
};

const SIZE_STYLES: Record<'sm' | 'md' | 'lg', { w: string; h: string; main: string; corner: string }> = {
  sm: { w: 'w-10', h: 'h-14', main: 'text-base', corner: 'text-[9px]' },
  md: { w: 'w-16', h: 'h-24', main: 'text-3xl', corner: 'text-xs' },
  lg: { w: 'w-20', h: 'h-28', main: 'text-4xl', corner: 'text-sm' },
};

export default function Card({
  card,
  faceDown,
  size = 'md',
  highlighted,
  dim,
  onClick,
  label,
  stacked,
  asValue,
  buildDirection,
}: CardProps) {
  const S = SIZE_STYLES[size];
  const interactable = !!onClick;
  const base = `${S.w} ${S.h} rounded-md relative select-none transition-[transform,box-shadow] will-change-transform`;
  const hover = interactable ? 'cursor-pointer hover:-translate-y-1 hover:shadow-lg' : '';
  const glow = highlighted ? 'card-glow' : 'shadow-[0_4px_6px_rgba(0,0,0,0.4)]';
  const dimmed = dim ? 'opacity-35' : '';

  // Empty slot with optional label
  if (!card && !faceDown) {
    return (
      <div
        className={`${base} ${hover} flex items-center justify-center border border-dashed border-white/25 bg-white/5 text-white/40 text-[10px] text-center px-1 leading-tight`}
        onClick={onClick}
      >
        {label ?? ''}
      </div>
    );
  }

  // Face-down card (stock pile back)
  if (faceDown) {
    return (
      <div className="relative">
        {stacked && stacked > 1 && (
          <div
            className={`${S.w} ${S.h} rounded-md card-back absolute top-0 left-0 translate-x-[2px] translate-y-[2px] opacity-70 shadow-md`}
          />
        )}
        <div
          className={`${base} ${hover} ${glow} ${dimmed} card-back border border-black/30 flex items-center justify-center relative z-10`}
          onClick={onClick}
        >
          <div className="w-8 h-8 rounded-full bg-white/15 border border-white/35 flex items-center justify-center text-[10px] font-bold text-white/80 tracking-widest">
            SB
          </div>
        </div>
      </div>
    );
  }

  const isWild = card!.value === WILD;
  const palette = paletteFor(card!.value);
  const styles = PALETTE_STYLES[palette];
  // When a wild has been played onto a build pile, `asValue` tells us the
  // number it is standing in for. The face then reads as that number while
  // keeping the wild palette so players see at a glance "this is a wild
  // acting as N".
  const showingAsNumber = isWild && asValue !== undefined && asValue !== WILD;
  const display = showingAsNumber
    ? String(asValue)
    : isWild
      ? 'SB'
      : String(card!.value);

  return (
    <div className="relative">
      {stacked && stacked > 1 && (
        <div
          className={`${S.w} ${S.h} rounded-md absolute top-0 left-0 translate-x-[2px] translate-y-[2px] opacity-70 border border-black/20`}
          style={{ background: styles.bg }}
        />
      )}
      <div
        className={`${base} ${hover} ${glow} ${dimmed} border border-black/30 relative z-10 flex items-center justify-center overflow-hidden`}
        style={{ background: styles.bg, color: styles.text }}
        onClick={onClick}
      >
        {/* Inner bevel ring. Wild cards get a gold ring; numbered cards stay
            subtle so the number dominates. */}
        <div
          className="absolute inset-[3px] rounded-[3px] border pointer-events-none"
          style={{
            borderColor: isWild ? 'var(--card-wild-accent)' : styles.accent,
            boxShadow: isWild ? 'inset 0 0 6px rgba(255,245,214,0.55)' : undefined,
          }}
        />
        {/* Corner rank (top-left) */}
        <div className={`absolute top-1 left-1.5 leading-none font-bold ${S.corner}`}>
          {display}
        </div>
        {/* Corner rank (bottom-right, rotated) */}
        <div
          className={`absolute bottom-1 right-1.5 leading-none font-bold ${S.corner}`}
          style={{ transform: 'rotate(180deg)' }}
        >
          {display}
        </div>
        {/* Center mark */}
        <div
          className={`font-extrabold ${S.main} drop-shadow-sm`}
          style={isWild && !showingAsNumber ? { letterSpacing: '0.08em' } : undefined}
        >
          {display}
        </div>

        {/* When acting as a number, stamp a small gold SB chip in the
            bottom-left so the wild origin is still readable without
            colliding with the build-direction arrow at top-right. */}
        {showingAsNumber && (
          <div
            aria-label={`Played as ${display}, originally wild`}
            className="absolute bottom-1 left-1 rounded px-1 text-[9px] font-black tracking-widest leading-none"
            style={{
              background: 'var(--card-wild-accent)',
              color: '#3d1a04',
              boxShadow: '0 0 0 1px rgba(0,0,0,0.25)',
            }}
          >
            SB
          </div>
        )}

        {/* Build-pile direction arrow, white so it pops on every palette. */}
        {buildDirection && (
          <div
            className="absolute top-1 right-1 leading-none drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]"
            aria-label={buildDirection === 'asc' ? 'ascending pile' : 'descending pile'}
          >
            <DirectionChevron direction={buildDirection} size={size === 'lg' ? 14 : size === 'md' ? 12 : 10} />
          </div>
        )}
      </div>
    </div>
  );
}
