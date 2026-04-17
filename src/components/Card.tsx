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
  wild: {
    bg: 'linear-gradient(160deg, var(--card-wild-a), var(--card-wild-b))',
    text: '#3b1d66',
    accent: 'rgba(75,30,130,0.25)',
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

  const palette = paletteFor(card!.value);
  const styles = PALETTE_STYLES[palette];
  const isWild = card!.value === WILD;
  const display = isWild ? 'SB' : String(card!.value);

  return (
    <div className="relative">
      {stacked && stacked > 1 && (
        <div
          className={`${S.w} ${S.h} rounded-md absolute top-0 left-0 translate-x-[2px] translate-y-[2px] opacity-70 border border-black/20`}
          style={{ background: styles.bg }}
        />
      )}
      <div
        className={`${base} ${hover} ${glow} ${dimmed} border border-black/30 relative z-10 flex items-center justify-center`}
        style={{ background: styles.bg, color: styles.text }}
        onClick={onClick}
      >
        {/* Inner bevel ring */}
        <div
          className="absolute inset-[3px] rounded-[4px] border pointer-events-none"
          style={{ borderColor: styles.accent }}
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
        <div className={`font-extrabold ${S.main} drop-shadow-sm`}>{display}</div>
        {isWild && (
          <>
            {/* Sun rays for wild */}
            <div
              className="absolute inset-0 rounded-md pointer-events-none"
              style={{
                background:
                  'conic-gradient(from 45deg, transparent 0deg, rgba(255,180,60,0.15) 30deg, transparent 60deg, rgba(255,180,60,0.15) 90deg, transparent 120deg, rgba(255,180,60,0.15) 150deg, transparent 180deg, rgba(255,180,60,0.15) 210deg, transparent 240deg, rgba(255,180,60,0.15) 270deg, transparent 300deg, rgba(255,180,60,0.15) 330deg, transparent 360deg)',
                mixBlendMode: 'overlay',
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
