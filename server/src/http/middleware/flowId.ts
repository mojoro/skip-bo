import type { IncomingMessage, ServerResponse } from 'node:http';
import { newFlowId } from '../../ids';

export function assignFlowId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = typeof req.headers['x-flow-id'] === 'string' ? req.headers['x-flow-id'] : undefined;
  const flowId = incoming ?? newFlowId();
  res.setHeader('x-flow-id', flowId);
  return flowId;
}
