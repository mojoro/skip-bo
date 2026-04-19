import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Skip-Bo — online card game',
    short_name: 'Skip-Bo',
    description:
      'Race to empty your stockpile in this classic Skip-Bo card game. Play online against friends in real-time rooms.',
    start_url: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#073825',
    theme_color: '#0e5e3e',
    categories: ['games', 'entertainment'],
    icons: [
      {
        src: '/icon.svg',
        type: 'image/svg+xml',
        sizes: 'any',
        purpose: 'any',
      },
      {
        src: '/apple-icon',
        type: 'image/png',
        sizes: '180x180',
        purpose: 'any',
      },
    ],
  };
}
