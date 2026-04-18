import type { Room } from '../types';

export const GRACE_MS = 60_000;

export interface StartGraceOpts {
  onExpire: () => void;
}

export function startGrace(room: Room, slotIndex: number, opts: StartGraceOpts): void {
  const slot = room.slots[slotIndex];
  if (!slot || slot.kind !== 'human') return;
  if (slot.graceTimer) clearTimeout(slot.graceTimer);
  slot.graceDeadline = Date.now() + GRACE_MS;
  slot.graceTimer = setTimeout(() => {
    slot.graceTimer = null;
    slot.graceDeadline = null;
    slot.botControlled = true;
    opts.onExpire();
  }, GRACE_MS);
  slot.graceTimer.unref();
}

export function cancelGrace(room: Room, slotIndex: number): void {
  const slot = room.slots[slotIndex];
  if (!slot || slot.kind !== 'human') return;
  if (slot.graceTimer) clearTimeout(slot.graceTimer);
  slot.graceTimer = null;
  slot.graceDeadline = null;
}

export function clearAllGraceTimers(room: Room): void {
  for (const slot of room.slots) {
    if (slot.kind === 'human' && slot.graceTimer) {
      clearTimeout(slot.graceTimer);
      slot.graceTimer = null;
      slot.graceDeadline = null;
    }
  }
}
