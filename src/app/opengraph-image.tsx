import { ImageResponse } from 'next/og';

export const alt = 'Skip-Bo: play the classic card game online';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

type Palette = 'blue' | 'green' | 'red' | 'wild';

// Match the in-game Card.tsx palette exactly so the OG preview reads as the
// actual game art, not a placeholder. Wild uses a deep violet with a gold
// accent ring — identical to the real wildcard after the redesign.
const PALETTES: Record<Palette, { bg: string; fg: string; accent: string }> = {
  blue: {
    bg: 'linear-gradient(160deg, #2a63b4, #184a92)',
    fg: '#ffffff',
    accent: 'rgba(255,255,255,0.35)',
  },
  green: {
    bg: 'linear-gradient(160deg, #2d8a4f, #1c5e34)',
    fg: '#ffffff',
    accent: 'rgba(255,255,255,0.35)',
  },
  red: {
    bg: 'linear-gradient(160deg, #c83b3b, #8c1f1f)',
    fg: '#ffffff',
    accent: 'rgba(255,255,255,0.3)',
  },
  wild: {
    bg: 'radial-gradient(circle at 30% 20%, #fde68a, #fbbf24 45%, #b45309 100%)',
    fg: '#3d1a04',
    accent: '#fff5d6',
  },
};

// Offsets are tuned so the rotated cards stay inside the right-hand 38%
// column: the outermost ±28° card's far corner reaches ~141px past its own
// center, so |offset| + 141 must not exceed the column half-width (228px).
// That keeps the fan clear of the left-side info text and the right edge.
const CARDS: Array<{ value: string; palette: Palette; rotate: number; offset: number }> = [
  { value: '2', palette: 'blue', rotate: -28, offset: -80 },
  { value: '4', palette: 'blue', rotate: 28, offset: 80 },
  { value: '7', palette: 'green', rotate: -14, offset: -42 },
  { value: '11', palette: 'red', rotate: 14, offset: 42 },
  { value: 'SB', palette: 'wild', rotate: 0, offset: 0 },
];

const CARD_WIDTH = 184;
const CARD_HEIGHT = 258;
const BEVEL_INSET = 10;

function CardFace({
  value,
  palette,
  rotate,
  offset,
}: {
  value: string;
  palette: Palette;
  rotate: number;
  offset: number;
}) {
  const p = PALETTES[palette];
  const isWild = value === 'SB';
  const mainFontSize = isWild ? 92 : 118;
  const cornerFontSize = 28;

  return (
    <div
      style={{
        position: 'absolute',
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        borderRadius: 16,
        border: '3px solid rgba(0,0,0,0.4)',
        background: p.bg,
        color: p.fg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 24px 44px rgba(0,0,0,0.55)',
        transform: `translateX(${offset}px) rotate(${rotate}deg)`,
      }}
    >
      {/* Inner bevel ring — gold on the wild, translucent white otherwise */}
      <div
        style={{
          position: 'absolute',
          top: BEVEL_INSET,
          right: BEVEL_INSET,
          bottom: BEVEL_INSET,
          left: BEVEL_INSET,
          borderRadius: 10,
          border: `2px solid ${p.accent}`,
        }}
      />

      {/* Corner rank — top-left */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 20,
          fontSize: cornerFontSize,
          fontWeight: 900,
          letterSpacing: isWild ? 2 : -1,
          lineHeight: 1,
          display: 'flex',
        }}
      >
        {value}
      </div>

      {/* Corner rank — bottom-right, rotated 180° */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          right: 20,
          fontSize: cornerFontSize,
          fontWeight: 900,
          letterSpacing: isWild ? 2 : -1,
          lineHeight: 1,
          transform: 'rotate(180deg)',
          display: 'flex',
        }}
      >
        {value}
      </div>

      {/* Center mark */}
      <div
        style={{
          fontSize: mainFontSize,
          fontWeight: 900,
          lineHeight: 1,
          letterSpacing: isWild ? 6 : -2,
          textShadow: '0 2px 6px rgba(0,0,0,0.35)',
          display: 'flex',
        }}
      >
        {value}
      </div>

      {/* Wild starburst — simulated with thin cream slivers pointing out
          from the center. Satori doesn't render conic-gradient, so we stamp
          the rays as rotated rectangles. Kept subtle so it frames the "SB"
          without overpowering the face. */}
      {isWild && (
        <>
          {[0, 45, 90, 135].map((deg) => (
            <div
              key={deg}
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                width: CARD_HEIGHT * 0.82,
                height: 3,
                background:
                  'linear-gradient(90deg, rgba(255,245,214,0) 0%, rgba(255,245,214,0.7) 50%, rgba(255,245,214,0) 100%)',
                transform: `translate(-50%, -50%) rotate(${deg}deg)`,
              }}
            />
          ))}
        </>
      )}
    </div>
  );
}

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Arial, sans-serif',
          background:
            'radial-gradient(ellipse at 50% 42%, #137a51 0%, #0e5e3e 50%, #073825 100%)',
          borderTop: '14px solid #2b180c',
          borderBottom: '14px solid #2b180c',
          borderLeft: '14px solid #2b180c',
          borderRight: '14px solid #2b180c',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            border: '2px solid #8a5a2e',
            pointerEvents: 'none',
          }}
        />

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            paddingLeft: 72,
            width: '62%',
          }}
        >
          <div
            style={{
              color: '#d9a441',
              fontSize: 24,
              letterSpacing: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              marginBottom: 14,
            }}
          >
            Card Game · Online
          </div>
          <div
            style={{
              color: '#ffffff',
              fontSize: 140,
              fontWeight: 900,
              lineHeight: 0.92,
              letterSpacing: -4,
              display: 'flex',
            }}
          >
            Skip-Bo
          </div>
          <div
            style={{
              color: 'rgba(255,255,255,0.88)',
              fontSize: 32,
              fontWeight: 500,
              marginTop: 20,
              display: 'flex',
            }}
          >
            Race to empty your stockpile.
          </div>
          <div
            style={{
              color: '#d9a441',
              fontSize: 24,
              fontWeight: 600,
              marginTop: 38,
              letterSpacing: 1,
              display: 'flex',
            }}
          >
            skipbo.johnmoorman.com
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: '38%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {CARDS.map((c) => (
            <CardFace
              key={c.value + c.offset}
              value={c.value}
              palette={c.palette}
              rotate={c.rotate}
              offset={c.offset}
            />
          ))}
        </div>
      </div>
    ),
    { ...size }
  );
}
