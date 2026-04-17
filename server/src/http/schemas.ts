import { z } from 'zod';

const NAME_RE = /^[\p{L}\p{N} ]+$/u;

const gameConfigSchema = z.object({
  ruleset: z.enum(['recommended', 'official']),
  stockPileSize: z.number().int().min(5).max(50),
  handSize: z.number().int().min(3).max(10),
  bidirectionalBuild: z.boolean(),
  maxPlayers: z.number().int().min(2).max(8),
  partnership: z
    .object({
      enabled: z.boolean(),
      teams: z.array(z.array(z.string())).min(2),
      allowPlayFromPartnerStock: z.boolean(),
      allowPlayFromPartnerDiscard: z.boolean(),
      allowDiscardToPartnerDiscard: z.boolean(),
    })
    .nullable(),
});

export const createRoomSchema = z.object({
  playerName: z.string().trim().min(1).max(20).regex(NAME_RE),
  displayName: z.string().trim().min(1).max(40).regex(NAME_RE).optional(),
  config: gameConfigSchema,
  allowAiFill: z.boolean(),
  visibility: z.enum(['public', 'private']),
});

export const joinRoomSchema = z.object({
  playerName: z.string().trim().min(1).max(20).regex(NAME_RE),
});

export const patchRoomSchema = z.object({
  displayName: z.string().trim().min(1).max(40).regex(NAME_RE).optional(),
  config: gameConfigSchema.partial().optional(),
  allowAiFill: z.boolean().optional(),
  visibility: z.enum(['public', 'private']).optional(),
});

export const setSlotSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('open') }),
  z.object({ kind: z.literal('locked') }),
  z.object({ kind: z.literal('ai'), difficulty: z.enum(['easy']) }),
]);
