// Positions player seats around a rectangular table in CSS percentages.
// "You" is always seated at the bottom-center; other seats are spread
// clockwise starting left-of-bottom, wrapping back round.

export interface SeatPosition {
  // CSS positioning values (0–100 in %) measured from the table's top-left.
  xPct: number;
  yPct: number;
  // Which side of the table the seat faces. Controls orientation of the row
  // (hand fans inward toward the center).
  side: 'bottom' | 'top' | 'left' | 'right';
}

// Pre-baked layouts for 2..8 seats. "you" is always index 0 (bottom).
// Positions are approximate anchor points; the seat component is placed
// via translate(-50%, -50%) around that anchor.
const LAYOUTS: Record<number, SeatPosition[]> = {
  2: [
    { xPct: 50, yPct: 88, side: 'bottom' },
    { xPct: 50, yPct: 12, side: 'top' },
  ],
  3: [
    { xPct: 50, yPct: 88, side: 'bottom' },
    { xPct: 12, yPct: 40, side: 'left' },
    { xPct: 88, yPct: 40, side: 'right' },
  ],
  4: [
    { xPct: 50, yPct: 88, side: 'bottom' },
    { xPct: 12, yPct: 50, side: 'left' },
    { xPct: 50, yPct: 12, side: 'top' },
    { xPct: 88, yPct: 50, side: 'right' },
  ],
  5: [
    { xPct: 50, yPct: 88, side: 'bottom' },
    { xPct: 12, yPct: 65, side: 'left' },
    { xPct: 25, yPct: 15, side: 'top' },
    { xPct: 75, yPct: 15, side: 'top' },
    { xPct: 88, yPct: 65, side: 'right' },
  ],
  6: [
    { xPct: 50, yPct: 88, side: 'bottom' },
    { xPct: 12, yPct: 70, side: 'left' },
    { xPct: 12, yPct: 30, side: 'left' },
    { xPct: 50, yPct: 12, side: 'top' },
    { xPct: 88, yPct: 30, side: 'right' },
    { xPct: 88, yPct: 70, side: 'right' },
  ],
  7: [
    { xPct: 50, yPct: 90, side: 'bottom' },
    { xPct: 15, yPct: 78, side: 'bottom' },
    { xPct: 10, yPct: 40, side: 'left' },
    { xPct: 30, yPct: 12, side: 'top' },
    { xPct: 70, yPct: 12, side: 'top' },
    { xPct: 90, yPct: 40, side: 'right' },
    { xPct: 85, yPct: 78, side: 'bottom' },
  ],
  8: [
    { xPct: 50, yPct: 90, side: 'bottom' },
    { xPct: 15, yPct: 82, side: 'bottom' },
    { xPct: 8, yPct: 50, side: 'left' },
    { xPct: 20, yPct: 14, side: 'top' },
    { xPct: 50, yPct: 10, side: 'top' },
    { xPct: 80, yPct: 14, side: 'top' },
    { xPct: 92, yPct: 50, side: 'right' },
    { xPct: 85, yPct: 82, side: 'bottom' },
  ],
};

export function getSeatPositions(count: number): SeatPosition[] {
  return LAYOUTS[count] ?? LAYOUTS[8];
}
