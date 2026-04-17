import { randomUUID } from 'node:crypto';

export function newFlowId(): string {
  return `flow-${randomUUID()}`;
}
