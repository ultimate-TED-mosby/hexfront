// Socket.IO contract between client and server. The client only ever sends intents.
import type { Action, GameState, Placement, PlayerId } from './types.js';

/** Credentials stored by the client (localStorage) to find its seat again after a reload. */
export interface Session {
  code: string;
  token: string;
  color: PlayerId;
}

export interface SeatInfo {
  /** A player has taken this seat. */
  joined: boolean;
  /** That player currently has an open connection. */
  connected: boolean;
}

/** Everything one player is allowed to see about a room. */
export interface RoomView {
  code: string;
  you: PlayerId;
  seats: Record<PlayerId, SeatInfo>;
  rematch: Record<PlayerId, boolean>;
  /** Game state already filtered by viewForPlayer (hidden enemy deployment). */
  game: GameState;
}

/** Acknowledgement returned by every client → server event. */
export type Ack<T = null> = { ok: true; data: T } | { ok: false; error: string };

export interface ClientToServerEvents {
  'room:create': (ack: (res: Ack<Session>) => void) => void;
  'room:join': (payload: { code: string }, ack: (res: Ack<Session>) => void) => void;
  'room:resume': (payload: { code: string; token: string }, ack: (res: Ack<Session>) => void) => void;
  'game:deploy': (payload: { placements: Placement[] }, ack: (res: Ack) => void) => void;
  'game:action': (payload: { action: Action }, ack: (res: Ack) => void) => void;
  'game:rematch': (ack: (res: Ack) => void) => void;
}

export interface ServerToClientEvents {
  'room:state': (view: RoomView) => void;
  /** This connection lost its seat (the same player opened the game in another tab). */
  'room:kicked': (reason: string) => void;
}

/** Room codes use an alphabet without ambiguous characters (no 0/O, 1/I/L). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

/** Normalizes a user-typed room code (trim, uppercase). */
export function normalizeRoomCode(code: string): string {
  return code.trim().toUpperCase();
}
