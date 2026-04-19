import { RingBuffer, type RingEntry } from './ringBuffer';
import type { LobbyEvent } from '../types';
import type { SseWriter } from './stream';

export class LobbyStreamRegistry {
  private readonly subscribers = new Map<string, SseWriter>();
  readonly buffer = new RingBuffer<LobbyEvent>(200);

  subscribe(sessionId: string, writer: SseWriter): void {
    const existing = this.subscribers.get(sessionId);
    if (existing && !existing.closed) existing.close();
    this.subscribers.set(sessionId, writer);
    writer.onClose(() => {
      if (this.subscribers.get(sessionId) === writer) this.subscribers.delete(sessionId);
    });
  }

  publish(event: LobbyEvent): RingEntry<LobbyEvent> {
    const entry = this.buffer.push(event);
    for (const w of [...this.subscribers.values()]) {
      if (w.closed) continue;
      w.sendEvent(event.type, event, entry.id);
    }
    return entry;
  }

  replaySince(writer: SseWriter, lastId: number): 'replayed' | 'needSnapshot' {
    const entries = this.buffer.since(lastId);
    if (entries === null) return 'needSnapshot';
    for (const e of entries) writer.sendEvent(e.value.type, e.value, e.id);
    return 'replayed';
  }

  size(): number {
    return [...this.subscribers.values()].filter((w) => !w.closed).length;
  }

  // SessionIds of every active subscriber. Used by the stats ticker to
  // union with seated humans so the "players online" count includes lobby
  // viewers who haven't joined a room yet.
  sessionIds(): string[] {
    const ids: string[] = [];
    for (const [sessionId, writer] of this.subscribers) {
      if (!writer.closed) ids.push(sessionId);
    }
    return ids;
  }
}
