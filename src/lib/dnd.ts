import { CardSource } from './game/types';

export type DragSourceData = { source: CardSource };

export type DropTargetData =
  | { kind: 'build'; index: number }
  | { kind: 'discard'; index: number };
