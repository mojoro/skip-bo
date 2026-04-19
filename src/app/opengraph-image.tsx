import { ImageResponse } from 'next/og';

export const alt = 'Skip-Bo — play the classic card game online';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

type Palette = 'blue' | 'green' | 'red' | 'wild';

const PALETTES: Record<Palette, { bg: string; fg: string }> = {
  blue: { bg: 'linear-gradient(160deg, #2a63b4, #184a92)', fg: '#ffffff' },
  green: { bg: 'linear-gradient(160deg, #2d8a4f, #1c5e34)', fg: '#ffffff' },
  red: { bg: 'linear-gradient(160deg, #c83b3b, #8c1f1f)', fg: '#ffffff' },
  wild: { bg: 'linear-gradient(160deg, #fff9ec, #f3e6c0)', fg: '#3b1d66' },
};

const CARDS: Array<{ value: string; palette: Palette; rotate: number; offset: number }> = [
  { value: '2', palette: 'blue', rotate: -28, offset: -160 },
  { value: '4', palette: 'blue', rotate: 28, offset: 160 },
  { value: '7', palette: 'green', rotate: -14, offset: -85 },
  { value: '11', palette: 'red', rotate: 14, offset: 85 },
  { value: 'SB', palette: 'wild', rotate: 0, offset: 0 },
];

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
          {CARDS.map((c) => {
            const p = PALETTES[c.palette];
            return (
              <div
                key={c.value + c.offset}
                style={{
                  position: 'absolute',
                  width: 184,
                  height: 258,
                  borderRadius: 16,
                  border: '3px solid rgba(0,0,0,0.4)',
                  background: p.bg,
                  color: p.fg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: c.value === 'SB' ? 84 : 110,
                  fontWeight: 900,
                  letterSpacing: c.value === 'SB' ? 4 : -2,
                  boxShadow: '0 24px 44px rgba(0,0,0,0.55)',
                  transform: `translateX(${c.offset}px) rotate(${c.rotate}deg)`,
                }}
              >
                {c.value}
              </div>
            );
          })}
        </div>
      </div>
    ),
    { ...size }
  );
}
