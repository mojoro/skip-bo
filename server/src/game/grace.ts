import type { Room } from '../types';

export const DEFAULT_GRACE_MS = 60_000;
// Mutable so integration tests can shrink the window without shipping a DI
// pipe through every call site. Production paths never touch this.
let GRACE_MS_OVERRIDE: number | null = null;
export const GRACE_MS = DEFAULT_GRACE_MS;

export function __setGraceMsForTest(ms: number | null): void {
  GRACE_MS_OVERRIDE = ms;
}

function currentGraceMs(): number {
  return GRACE_MS_OVERRIDE ?? DEFAULT_GRACE_MS;
}

export interface StartGraceOpts {
  onExpire: () => void;
}

export function startGrace(room: Room, slotIndex: number, opts: StartGraceOpts): void {
  const slot = room.slots[slotIndex];
  if (!slot || slot.kind !== 'human') return;
  if (slot.graceTimer) clearTimeout(slot.graceTimer);
  const duration = currentGraceMs();
  slot.graceDeadline = Date.now() + duration;
  slot.graceTimer = setTimeout(() => {
    const current = room.slots[slotIndex];
    if (!current || current.kind !== 'human') return;
    current.graceTimer = null;
    current.graceDeadline = null;
    current.botControlled = true;
    opts.onExpire();
  }, duration);
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
