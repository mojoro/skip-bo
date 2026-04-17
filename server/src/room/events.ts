// server/src/room/events.ts
import { EventEmitter } from 'node:events';
import type { LobbyEvent } from '../types';

type LobbyEventName = LobbyEvent['type'];
type PayloadFor<N extends LobbyEventName> = Extract<LobbyEvent, { type: N }>;

export class LobbyEventBus {
  private readonly emitter = new EventEmitter({ captureRejections: true });

  emit<N extends LobbyEventName>(name: N, payload: PayloadFor<N>): void {
    this.emitter.emit(name, payload);
  }

  on<N extends LobbyEventName>(name: N, handler: (payload: PayloadFor<N>) => void): () => void {
    this.emitter.on(name, handler as (payload: unknown) => void);
    return () => this.emitter.off(name, handler as (payload: unknown) => void);
  }
}
