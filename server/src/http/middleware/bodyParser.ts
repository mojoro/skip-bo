import type { IncomingMessage } from 'node:http';
import { config } from '../../config';

export class BodyError extends Error {
  constructor(public readonly kind: 'tooLarge' | 'badJson') { super(kind); }
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > config.maxBodyBytes) {
      req.destroy();
      throw new BodyError('tooLarge');
    }
    chunks.push(buf);
  }
  if (total === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BodyError('badJson');
  }
}
