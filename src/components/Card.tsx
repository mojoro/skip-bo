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
  // Deep violet with a gold accent ring — the wild now reads as premium and
  // stands out clearly from any numbered suit.
  wild: {
    bg: 'radial-gradient(circle at 30% 20%, #6b3cd6, var(--card-wild-a) 45%, var(--card-wild-b) 100%)',
    text: '#ffffff',
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
}: CardProps) {
  const S = SIZE_STYLES[size];
  const interactable = !!onClick;
  const base = `${S.w} ${S.h} rounded-md relative select-none transition-transform will-change-transform`;
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
          className="absolute inset-[3px] rounded-[4px] border pointer-events-none"
          style={{
            borderColor: isWild ? 'var(--card-wild-accent)' : styles.accent,
            boxShadow: isWild ? 'inset 0 0 6px rgba(242,198,90,0.35)' : undefined,
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

        {/* Wild embellishments — starburst rays + gold inner ring — only on
            the raw wildcard face, not when standing in as a number. */}
        {isWild && !showingAsNumber && (
          <div
            aria-hidden
            className="absolute inset-0 rounded-md pointer-events-none"
            style={{
              background:
                'repeating-conic-gradient(from 22.5deg, rgba(242,198,90,0.18) 0deg 9deg, transparent 9deg 22.5deg)',
              mixBlendMode: 'screen',
              opacity: 0.55,
            }}
          />
        )}

        {/* When acting as a number, stamp a small gold SB chip so the wild
            origin is still readable. */}
        {showingAsNumber && (
          <div
            aria-label={`Played as ${display}, originally wild`}
            className="absolute top-1 right-1 rounded px-1 text-[9px] font-black tracking-widest leading-none"
            style={{
              background: 'var(--card-wild-accent)',
              color: '#2a0f5a',
              boxShadow: '0 0 0 1px rgba(0,0,0,0.25)',
            }}
          >
            SB
          </div>
        )}
      </div>
    </div>
  );
}
