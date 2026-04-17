import { Card, CardSource } from './game/types';

export type DragSourceData = { source: CardSource; card: Card };

export type DropTargetData =
  | { kind: 'build'; index: number }
  | { kind: 'discard'; index: number };
