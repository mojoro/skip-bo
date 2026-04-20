import type { GameConfig } from '@/lib/game/types';
import type { RoomInfo } from './protocol';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly title: string,
    public readonly detail: string | null,
    public readonly reason: string | null,
  ) {
    super(`${status} ${title}${detail ? `: ${detail}` : ''}`);
  }
}

interface WithAuth {
  baseUrl: string;
  sessionId: string;
}

async function parseResponse<T>(res: Response): Promise<T> {
  if (res.ok) return res.json() as Promise<T>;
  const ctype = res.headers.get('content-type') ?? '';
  if (ctype.includes('application/problem+json')) {
    const body = (await res.json().catch(() => ({}))) as {
      title?: string; detail?: string; reason?: string;
    };
    throw new ApiError(res.status, body.title ?? res.statusText, body.detail ?? null, body.reason ?? null);
  }
  throw new ApiError(res.status, res.statusText, null, null);
}

function authHeaders(sessionId: string): HeadersInit {
  return {
    authorization: `Bearer ${sessionId}`,
    'content-type': 'application/json',
  };
}

export interface CreateRoomInput extends WithAuth {
  body: {
    playerName: string;
    displayName?: string;
    config: GameConfig;
    allowAiFill: boolean;
    visibility: 'public' | 'private';
  };
}

export async function createRoom(input: CreateRoomInput): Promise<{ roomId: string; code: string }> {
  const res = await fetch(`${input.baseUrl}/v1/rooms`, {
    method: 'POST',
    headers: authHeaders(input.sessionId),
    body: JSON.stringify(input.body),
  });
  return parseResponse(res);
}

export interface JoinRoomInput extends WithAuth {
  roomId: string;
  playerName: string;
}

export async function joinRoom(input: JoinRoomInput): Promise<{ room: RoomInfo; slotIndex: number }> {
  const res = await fetch(`${input.baseUrl}/v1/rooms/${encodeURIComponent(input.roomId)}/members`, {
    method: 'POST',
    headers: authHeaders(input.sessionId),
    body: JSON.stringify({ playerName: input.playerName }),
  });
  return parseResponse(res);
}

export interface LeaveRoomInput extends WithAuth {
  roomId: string;
  targetSessionId: string;
}

export async function leaveRoom(input: LeaveRoomInput): Promise<void> {
  const res = await fetch(
    `${input.baseUrl}/v1/rooms/${encodeURIComponent(input.roomId)}/members/${encodeURIComponent(input.targetSessionId)}`,
    { method: 'DELETE', headers: authHeaders(input.sessionId) },
  );
  if (!res.ok && res.status !== 204) await parseResponse(res);
}

export interface SetSlotInput extends WithAuth {
  roomId: string;
  index: number;
  desired: { kind: 'open' | 'locked' } | { kind: 'ai'; difficulty: 'easy' };
}

export async function setSlot(input: SetSlotInput): Promise<void> {
  const res = await fetch(
    `${input.baseUrl}/v1/rooms/${encodeURIComponent(input.roomId)}/slots/${input.index}`,
    {
      method: 'PUT',
      headers: authHeaders(input.sessionId),
      body: JSON.stringify(input.desired),
    },
  );
  if (!res.ok && res.status !== 204) await parseResponse(res);
}

export interface PatchRoomInput extends WithAuth {
  roomId: string;
  // Server accepts a partial GameConfig (see `patchRoomSchema` —
  // `gameConfigSchema.partial().optional()`). Typing `config` as
  // Partial<GameConfig> here lets callers omit fields they don't want to
  // touch, e.g. partnership teams (server rebuilds those at startGame).
  patch: Partial<{ displayName: string; config: Partial<GameConfig>; allowAiFill: boolean; visibility: 'public' | 'private' }>;
}

export async function patchRoom(input: PatchRoomInput): Promise<void> {
  const res = await fetch(
    `${input.baseUrl}/v1/rooms/${encodeURIComponent(input.roomId)}`,
    {
      method: 'PATCH',
      headers: { ...authHeaders(input.sessionId) as Record<string, string>, 'content-type': 'application/merge-patch+json' },
      body: JSON.stringify(input.patch),
    },
  );
  if (!res.ok && res.status !== 204) await parseResponse(res);
}

export interface StartGameInput extends WithAuth {
  roomId: string;
}

export async function startGame(input: StartGameInput): Promise<{ startedAt: number }> {
  const res = await fetch(
    `${input.baseUrl}/v1/rooms/${encodeURIComponent(input.roomId)}/game`,
    { method: 'POST', headers: authHeaders(input.sessionId) },
  );
  return parseResponse(res);
}

export interface FindRoomByCodeInput {
  baseUrl: string;
  code: string;
}

export interface GetMyRoomInput extends WithAuth {}

// Resolves the session's current room via `/v1/me/room`. Returns null when
// the session is not seated. Used by the lobby to show a "resume your game"
// banner and disable create/join forms while a session is already in a room.
export async function getMyRoom(input: GetMyRoomInput): Promise<{ roomId: string | null }> {
  const res = await fetch(`${input.baseUrl}/v1/me/room`, {
    method: 'GET',
    headers: authHeaders(input.sessionId),
  });
  return parseResponse(res);
}

export async function findRoomByCode(input: FindRoomByCodeInput): Promise<RoomInfo | null> {
  const res = await fetch(
    `${input.baseUrl}/v1/rooms?code=${encodeURIComponent(input.code)}`,
    { method: 'GET' },
  );
  const body = await parseResponse<{ rooms: RoomInfo[] }>(res);
  return body.rooms[0] ?? null;
}
