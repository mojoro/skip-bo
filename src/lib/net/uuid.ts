// Generates a UUID v4 that works in browser contexts where
// `crypto.randomUUID()` isn't available. Specifically: insecure contexts
// (HTTP over a LAN IP, not localhost) strip `crypto.randomUUID` while
// still exposing `crypto.getRandomValues`. `globalThis.crypto` exists and
// is non-null in every supported browser — we only feature-detect
// `randomUUID` because that's the one that gets pulled.

export function randomUUID(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Fallback: RFC 4122 v4 using getRandomValues. Same byte layout as
  // `crypto.randomUUID`, just reassembled manually.
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10xx
  const hex: string[] = [];
  for (let i = 0; i < 16; i++) hex.push(bytes[i]!.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}
