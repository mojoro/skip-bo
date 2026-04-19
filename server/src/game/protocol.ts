import { z } from 'zod';
import type { GameAction } from '@engine/types';
import type { GameView } from './view';

export const MAX_CHAT_LEN = 200;
export const MAX_MESSAGE_BYTES = 16 * 1024;

const CardSourceSchema = z.union([
  z.object({ from: z.literal('hand'), index: z.number().int().min(0) }).strict(),
  z.object({ from: z.literal('stock'), playerIndex: z.number().int().min(0) }).strict(),
  z.object({
    from: z.literal('discard'),
    playerIndex: z.number().int().min(0),
    pileIndex: z.number().int().min(0),
  }).strict(),
]);

const BuildDirectionSchema = z.union([z.literal('asc'), z.literal('desc'), z.null()]);

const GameActionSchema: z.ZodType<GameAction> = z.union([
  z.object({
    type: z.literal('PLAY_TO_BUILD'),
    source: CardSourceSchema,
    buildPileIndex: z.number().int().min(0),
    declaredDirection: BuildDirectionSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal('DISCARD'),
    handIndex: z.number().int().min(0),
    discardPileIndex: z.number().int().min(0),
    targetPlayerIndex: z.number().int().min(0),
  }).strict(),
]);

export const ClientMessageSchema = z.union([
  z.object({ type: z.literal('action'), action: GameActionSchema }).strict(),
  z.object({ type: z.literal('chat'), text: z.string().min(1).max(MAX_CHAT_LEN) }).strict(),
  z.object({ type: z.literal('requestRematch') }).strict(),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type ServerMessage =
  | { type: 'hello';       stateVersion: number; view: GameView }
  | { type: 'state';       stateVersion: number; view: GameView }
  | { type: 'actionError'; reason: string; stateVersion: number }
  | { type: 'chat';        fromSlotIndex: number; fromName: string; text: string; sentAt: number }
  | { type: 'gameEnded';   stateVersion: number; view: GameView; reason: 'winner' | 'abandoned' }
  | { type: 'rematchReady'; newRoomId: string };
