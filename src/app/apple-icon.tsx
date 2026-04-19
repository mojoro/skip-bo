import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background:
            'radial-gradient(circle at 50% 42%, #137a51 0%, #0e5e3e 48%, #073825 100%)',
        }}
      >
        <div
          style={{
            width: 116,
            height: 148,
            borderRadius: 18,
            background: 'linear-gradient(160deg, #1e3a8a, #172554)',
            border: '3px solid #d9a441',
            boxShadow:
              '0 16px 30px rgba(0,0,0,0.55), inset 0 0 0 2px rgba(255,255,255,0.08)',
            transform: 'rotate(-8deg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#d9a441',
            fontSize: 64,
            fontWeight: 900,
            letterSpacing: 2,
            fontFamily: 'system-ui, -apple-system, Segoe UI, Arial, sans-serif',
          }}
        >
          SB
        </div>
      </div>
    ),
    { ...size }
  );
}
