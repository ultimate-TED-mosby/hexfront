// HTTP + Socket.IO wiring: thin layer that checks payload shapes and delegates to RoomManager.
import { existsSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import type { Ack, ClientToServerEvents, PlayerId, ServerToClientEvents, Session } from '@hexfront/shared';
import { RoomManager, type Room } from './rooms.js';
import { parseAction, parsePlacements, parseString } from './validate.js';

interface SocketData {
  code?: string;
  color?: PlayerId;
}

type GameServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export interface AppOptions {
  /** Folder of the built client (served in production); skipped if missing. */
  clientDist?: string;
  rooms?: RoomManager;
  sweepIntervalMs?: number;
}

export interface App {
  httpServer: HttpServer;
  io: GameServer;
  rooms: RoomManager;
  close: () => Promise<void>;
}

/** Returns the ack callback, or a no-op if the client sent none (avoids crashing on a bad client). */
function safeAck<T>(ack: unknown): (res: Ack<T>) => void {
  return typeof ack === 'function' ? (ack as (res: Ack<T>) => void) : () => {};
}

/** Creates the Express app, the HTTP server and the Socket.IO server (not listening yet). */
export function createApp(options: AppOptions = {}): App {
  const rooms = options.rooms ?? new RoomManager();
  const app = express();
  app.disable('x-powered-by');
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, rooms: rooms.size });
  });

  const clientDist = options.clientDist;
  if (clientDist && existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist, { index: 'index.html', maxAge: '1h' }));
    // SPA fallback: any other GET returns index.html (the client reads ?game=CODE).
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  const httpServer = createServer(app);
  const io: GameServer = new Server(httpServer, { serveClient: false });

  /** Sends each connected seat its own filtered view of the room. */
  const broadcast = (room: Room) => {
    for (const color of ['blue', 'red'] as const) {
      const socketId = room.seats[color]?.socketId;
      if (!socketId) continue;
      const socket = io.sockets.sockets.get(socketId);
      if (socket) socket.data.color = color; // colors swap on rematch
      io.to(socketId).emit('room:state', rooms.viewFor(room, color));
    }
  };

  /** Binds a socket to a seat, releasing any previous seat it held. */
  const bind = (socket: GameSocket, code: string, color: PlayerId) => {
    if (socket.data.code && socket.data.code !== code) {
      const previous = rooms.disconnect(socket.data.code, socket.id);
      if (previous) broadcast(previous);
    }
    socket.data.code = code;
    socket.data.color = color;
  };

  /** Room and color of a seated socket, or null if it holds no seat. */
  const seated = (socket: GameSocket): { code: string; color: PlayerId } | null =>
    socket.data.code && socket.data.color ? { code: socket.data.code, color: socket.data.color } : null;

  io.on('connection', (socket: GameSocket) => {
    socket.on('room:create', (rawAck) => {
      const ack = safeAck<Session>(rawAck);
      const res = rooms.create(socket.id);
      if (!res.ok) return ack({ ok: false, error: res.error });
      bind(socket, res.value.code, res.value.color);
      ack({ ok: true, data: res.value });
      broadcast(rooms.get(res.value.code)!);
    });

    socket.on('room:join', (payload, rawAck) => {
      const ack = safeAck<Session>(rawAck);
      const code = parseString((payload as { code?: unknown } | undefined)?.code);
      if (!code) return ack({ ok: false, error: 'Code de partie invalide.' });
      const res = rooms.join(code, socket.id);
      if (!res.ok) return ack({ ok: false, error: res.error });
      bind(socket, res.value.code, res.value.color);
      ack({ ok: true, data: res.value });
      broadcast(rooms.get(res.value.code)!);
    });

    socket.on('room:resume', (payload, rawAck) => {
      const ack = safeAck<Session>(rawAck);
      const p = payload as { code?: unknown; token?: unknown } | undefined;
      const code = parseString(p?.code);
      const token = parseString(p?.token);
      if (!code || !token) return ack({ ok: false, error: 'Session invalide.' });
      const res = rooms.resume(code, token, socket.id);
      if (!res.ok) return ack({ ok: false, error: res.error });
      const { session, replaced } = res.value;
      if (replaced) {
        const old = io.sockets.sockets.get(replaced);
        if (old) {
          old.data.code = undefined;
          old.data.color = undefined;
          old.emit('room:kicked', 'Partie ouverte dans un autre onglet.');
        }
      }
      bind(socket, session.code, session.color);
      ack({ ok: true, data: session });
      broadcast(rooms.get(session.code)!);
    });

    socket.on('game:deploy', (payload, rawAck) => {
      const ack = safeAck<null>(rawAck);
      const seat = seated(socket);
      if (!seat) return ack({ ok: false, error: "Vous n'êtes dans aucune partie." });
      const placements = parsePlacements(payload);
      if (!placements) return ack({ ok: false, error: 'Déploiement mal formé.' });
      const res = rooms.deploy(seat.code, seat.color, placements);
      if (!res.ok) return ack({ ok: false, error: res.error });
      ack({ ok: true, data: null });
      broadcast(res.value);
    });

    socket.on('game:action', (payload, rawAck) => {
      const ack = safeAck<null>(rawAck);
      const seat = seated(socket);
      if (!seat) return ack({ ok: false, error: "Vous n'êtes dans aucune partie." });
      const action = parseAction(payload);
      if (!action) return ack({ ok: false, error: 'Action mal formée.' });
      const res = rooms.act(seat.code, seat.color, action);
      if (!res.ok) return ack({ ok: false, error: res.error });
      ack({ ok: true, data: null });
      broadcast(res.value);
    });

    socket.on('game:rematch', (rawAck) => {
      const ack = safeAck<null>(rawAck);
      const seat = seated(socket);
      if (!seat) return ack({ ok: false, error: "Vous n'êtes dans aucune partie." });
      const res = rooms.voteRematch(seat.code, seat.color);
      if (!res.ok) return ack({ ok: false, error: res.error });
      ack({ ok: true, data: null });
      broadcast(res.value.room);
    });

    socket.on('disconnect', () => {
      if (!socket.data.code) return;
      const room = rooms.disconnect(socket.data.code, socket.id);
      if (room) broadcast(room);
    });
  });

  const sweepTimer = setInterval(() => rooms.sweep(), options.sweepIntervalMs ?? 10 * 60 * 1000);
  sweepTimer.unref();

  const close = () =>
    new Promise<void>((resolve) => {
      clearInterval(sweepTimer);
      io.close(() => resolve());
    });

  return { httpServer, io, rooms, close };
}
