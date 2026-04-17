import type { ServerResponse } from 'node:http';
import { problemResponse, problemFromError, type ProblemResponse } from '../../problemJson';
import { BodyError } from './bodyParser';

export function writeProblem(res: ServerResponse, resp: ProblemResponse): void {
  res.statusCode = resp.statusCode;
  for (const [k, v] of Object.entries(resp.headers)) res.setHeader(k, v);
  res.end(resp.body);
}

export function handleUnknown(res: ServerResponse, err: unknown, instance: string): void {
  if (err instanceof BodyError) {
    writeProblem(res, problemResponse({
      type: 'https://skip-bo.example.com/problems/' + (err.kind === 'tooLarge' ? 'payload-too-large' : 'bad-json'),
      title: err.kind === 'tooLarge' ? 'Payload too large' : 'Invalid JSON',
      status: err.kind === 'tooLarge' ? 413 : 400,
      instance,
    }));
    return;
  }
  writeProblem(res, problemFromError(err, instance));
}
