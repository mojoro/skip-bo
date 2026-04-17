import type { ServerResponse } from 'node:http';
import type { z } from 'zod';
import { writeProblem } from '../middleware/errorHandler';
import { problemResponse } from '../../problemJson';

export function unauthorized(res: ServerResponse, instance: string): void {
  writeProblem(res, problemResponse({ type: 'https://skip-bo.example.com/problems/unauthorized', title: 'Unauthorized', status: 401, instance }));
}
export function forbidden(res: ServerResponse, instance: string): void {
  writeProblem(res, problemResponse({ type: 'https://skip-bo.example.com/problems/forbidden', title: 'Forbidden', status: 403, instance }));
}
export function notFound(res: ServerResponse, instance: string): void {
  writeProblem(res, problemResponse({ type: 'https://skip-bo.example.com/problems/not-found', title: 'Not Found', status: 404, instance }));
}
export function conflict(res: ServerResponse, instance: string, reason: string, detail: string): void {
  writeProblem(res, problemResponse({ type: `https://skip-bo.example.com/problems/${reason}`, title: reason, status: 409, detail, instance }));
}
export function unprocessable(res: ServerResponse, instance: string, err: z.ZodError): void {
  writeProblem(res, problemResponse({
    type: 'https://skip-bo.example.com/problems/validation',
    title: 'Validation Failed', status: 422, instance,
    detail: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
  }));
}
