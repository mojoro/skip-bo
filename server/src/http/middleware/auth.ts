import type { IncomingMessage } from 'node:http';

export function extractBearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const match = /^Bearer\s+(.+)$/.exec(h);
  return match ? match[1]!.trim() : null;
}
