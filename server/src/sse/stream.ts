import type { ServerResponse } from 'node:http';

export interface SseWriter {
  sendEvent(name: string, data: unknown, id?: number): void;
  sendComment(comment: string): void;
  close(): void;
  readonly closed: boolean;
  onClose(cb: () => void): void;
}

export function openSseStream(res: ServerResponse): SseWriter {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache, no-transform');
  res.setHeader('connection', 'keep-alive');
  res.setHeader('x-accel-buffering', 'no');
  res.flushHeaders?.();
  let closed = false;
  const closeListeners: Array<() => void> = [];
  const onEnd = () => {
    closed = true;
    for (const cb of closeListeners) cb();
  };
  res.on('close', onEnd);
  res.on('finish', onEnd);
  return {
    get closed() { return closed; },
    sendEvent(name, data, id) {
      if (closed) return;
      let chunk = '';
      if (id !== undefined) chunk += `id: ${id}\n`;
      chunk += `event: ${name}\n`;
      chunk += `data: ${JSON.stringify(data)}\n\n`;
      res.write(chunk);
    },
    sendComment(comment) {
      if (closed) return;
      res.write(`: ${comment}\n\n`);
    },
    close() {
      if (closed) return;
      closed = true;
      res.end();
    },
    onClose(cb) {
      if (closed) cb();
      else closeListeners.push(cb);
    },
  };
}
