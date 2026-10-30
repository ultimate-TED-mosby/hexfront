// In-memory rooms: two seats, the authoritative game state and rematch votes. No socket code here.
import { randomInt, randomUUID } from 'node:crypto';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  applyAction,
  applyDeployment,
  createGame,
  normalizeRoomCode,
  opponent,
  viewForPlayer,
} from '@hexfront/shared';
import type { Action, GameState, Placement, PlayerId, RoomView, Session } from '@hexfront/shared';

export interface Seat {
  token: string;
  /** Id of the socket currently holding the seat, or null when disconnected. */
  socketId: string | null;
}

export interface Room {
  code: string;
  seats: Record<PlayerId, Seat | null>;
  game: GameState;
  rematch: Record<PlayerId, boolean>;
  lastActivity: number;
}

export type RoomResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface RoomManagerOptions {
  maxRooms?: number;
  /** Idle rooms with nobody connected are deleted after this delay. */
  idleTtlMs?: number;
  now?: () => number;
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly maxRooms: number;
  private readonly idleTtlMs: number;
  private readonly now: () => number;

  constructor(options: RoomManagerOptions = {}) {
    this.maxRooms = options.maxRooms ?? 500;
    this.idleTtlMs = options.idleTtlMs ?? 2 * 60 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  /** Number of rooms currently in memory. */
  get size(): number {
    return this.rooms.size;
  }

  /** Room by code (case-insensitive), if it exists. */
  get(code: string): Room | undefined {
    return this.rooms.get(normalizeRoomCode(code));
  }

  /** Creates a room; the creator gets a random color (blue always plays first). */
  create(socketId: string): RoomResult<Session> {
    if (this.rooms.size >= this.maxRooms) return { ok: false, error: 'Serveur plein, réessayez plus tard.' };
    const code = this.newCode();
    const color: PlayerId = randomInt(2) === 0 ? 'blue' : 'red';
    const room: Room = {
      code,
      seats: { blue: null, red: null },
      game: createGame(),
      rematch: { blue: false, red: false },
      lastActivity: this.now(),
    };
    const token = randomUUID();
    room.seats[color] = { token, socketId };
    this.rooms.set(code, room);
    return { ok: true, value: { code, token, color } };
  }

  /** Takes the free seat of a room. */
  join(code: string, socketId: string): RoomResult<Session> {
    const room = this.get(code);
    if (!room) return { ok: false, error: 'Partie introuvable.' };
    const free = (['blue', 'red'] as const).find((c) => room.seats[c] === null);
    if (!free) return { ok: false, error: 'Cette partie est déjà complète.' };
    const token = randomUUID();
    room.seats[free] = { token, socketId };
    room.lastActivity = this.now();
    return { ok: true, value: { code: room.code, token, color: free } };
  }

  /** Reclaims a seat with its secret token; returns the socket id it replaces, if any. */
  resume(code: string, token: string, socketId: string): RoomResult<{ session: Session; replaced: string | null }> {
    const room = this.get(code);
    if (!room) return { ok: false, error: 'Partie introuvable (le serveur a peut-être redémarré).' };
    const color = (['blue', 'red'] as const).find((c) => room.seats[c]?.token === token);
    if (!color) return { ok: false, error: 'Jeton invalide pour cette partie.' };
    const seat = room.seats[color]!;
    const replaced = seat.socketId !== null && seat.socketId !== socketId ? seat.socketId : null;
    seat.socketId = socketId;
    room.lastActivity = this.now();
    return { ok: true, value: { session: { code: room.code, token, color }, replaced } };
  }

  /** Marks a socket as disconnected; returns the room it was seated in, if any. */
  disconnect(code: string, socketId: string): Room | undefined {
    const room = this.get(code);
    if (!room) return undefined;
    for (const c of ['blue', 'red'] as const) {
      const seat = room.seats[c];
      if (seat?.socketId === socketId) seat.socketId = null;
    }
    room.lastActivity = this.now();
    return room;
  }

  /** Submits a player's secret deployment. */
  deploy(code: string, color: PlayerId, placements: Placement[]): RoomResult<Room> {
    const room = this.get(code);
    if (!room) return { ok: false, error: 'Partie introuvable.' };
    if (!room.seats.blue || !room.seats.red) return { ok: false, error: 'Attendez que votre adversaire rejoigne la partie.' };
    const res = applyDeployment(room.game, color, placements);
    if (!res.ok) return { ok: false, error: res.error };
    room.game = res.state;
    room.lastActivity = this.now();
    return { ok: true, value: room };
  }

  /** Applies a game action through the shared rules (server-side validation). */
  act(code: string, color: PlayerId, action: Action): RoomResult<Room> {
    const room = this.get(code);
    if (!room) return { ok: false, error: 'Partie introuvable.' };
    const res = applyAction(room.game, color, action);
    if (!res.ok) return { ok: false, error: res.error };
    room.game = res.state;
    room.lastActivity = this.now();
    return { ok: true, value: room };
  }

  /** Records a rematch vote; when both agree, starts a new game with colors swapped. */
  voteRematch(code: string, color: PlayerId): RoomResult<{ room: Room; restarted: boolean }> {
    const room = this.get(code);
    if (!room) return { ok: false, error: 'Partie introuvable.' };
    if (room.game.phase !== 'finished') return { ok: false, error: "La partie n'est pas terminée." };
    room.rematch[color] = true;
    room.lastActivity = this.now();
    if (!room.rematch[opponent(color)]) return { ok: true, value: { room, restarted: false } };
    room.seats = { blue: room.seats.red, red: room.seats.blue };
    room.game = createGame();
    room.rematch = { blue: false, red: false };
    return { ok: true, value: { room, restarted: true } };
  }

  /** What one seat is allowed to see. */
  viewFor(room: Room, color: PlayerId): RoomView {
    const seatInfo = (c: PlayerId) => ({ joined: room.seats[c] !== null, connected: room.seats[c]?.socketId != null });
    return {
      code: room.code,
      you: color,
      seats: { blue: seatInfo('blue'), red: seatInfo('red') },
      rematch: { ...room.rematch },
      game: viewForPlayer(room.game, color),
    };
  }

  /** Deletes rooms with nobody connected and no activity for longer than the TTL; returns how many. */
  sweep(): number {
    let removed = 0;
    for (const [code, room] of this.rooms) {
      const anyoneConnected = (['blue', 'red'] as const).some((c) => room.seats[c]?.socketId);
      if (!anyoneConnected && this.now() - room.lastActivity > this.idleTtlMs) {
        this.rooms.delete(code);
        removed++;
      }
    }
    return removed;
  }

  /** Generates an unused room code. */
  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }
}
