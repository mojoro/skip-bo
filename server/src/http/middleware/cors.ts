import type { IncomingMessage, ServerResponse } from 'node:http';

export function applyCors(
  req: IncomingMessage,
  res: ServerResponse,
  allowedOrigin: string,
): { isPreflight: boolean } {
  const origin = req.headers.origin ?? '';
  const allowOrigin = allowedOrigin === '*' ? '*' : origin === allowedOrigin ? allowedOrigin : '';
  if (allowOrigin) {
    res.setHeader('access-control-allow-origin', allowOrigin);
    res.setHeader('vary', 'origin');
  }
  res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('access-control-allow-headers', 'authorization, content-type, x-flow-id, idempotency-key');
  res.setHeader('access-control-max-age', '600');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return { isPreflight: true };
  }
  return { isPreflight: false };
}
