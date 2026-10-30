// Connection to the server: one socket, the current room view and the intents the UI can send.
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Ack, Action, ClientToServerEvents, Placement, RoomView, ServerToClientEvents, Session } from '@hexfront/shared';
import { clearSession, codeFromUrl, loadTabSession, saveSession, setUrlCode } from './session';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type Status = 'connecting' | 'home' | 'joining' | 'in-room' | 'kicked';

export interface RoomApi {
  status: Status;
  connected: boolean;
  room: RoomView | null;
  error: string | null;
  clearError: () => void;
  create: () => Promise<void>;
  join: (code: string) => Promise<void>;
  resume: (session: Session) => Promise<boolean>;
  deploy: (placements: Placement[]) => Promise<boolean>;
  act: (action: Action) => Promise<boolean>;
  rematch: () => Promise<void>;
  leave: () => void;
}

/** Hook owning the socket lifecycle; components only see RoomApi. */
export function useRoom(): RoomApi {
  const socketRef = useRef<GameSocket | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Stores a freshly obtained seat. */
  const enter = useCallback((session: Session) => {
    sessionRef.current = session;
    saveSession(session);
    setUrlCode(session.code);
    setStatus('in-room');
  }, []);

  /** Unwraps an ack, surfacing errors to the UI. */
  const check = useCallback(<T,>(res: Ack<T>): res is { ok: true; data: T } => {
    if (!res.ok) setError(res.error);
    return res.ok;
  }, []);

  const resume = useCallback(
    async (session: Session) => {
      const socket = socketRef.current;
      if (!socket) return false;
      const res = await socket.emitWithAck('room:resume', { code: session.code, token: session.token });
      if (!res.ok) return false;
      enter(res.data);
      return true;
    },
    [enter],
  );

  const join = useCallback(
    async (code: string) => {
      const socket = socketRef.current;
      if (!socket) return;
      setStatus('joining');
      const res = await socket.emitWithAck('room:join', { code });
      if (check(res)) enter(res.data);
      else {
        setUrlCode(null);
        setStatus('home');
      }
    },
    [check, enter],
  );

  useEffect(() => {
    const socket: GameSocket = io({ autoConnect: true });
    socketRef.current = socket;

    socket.on('room:state', (view) => {
      setRoom(view);
      if (sessionRef.current && sessionRef.current.color !== view.you) {
        // Colors are swapped after a rematch: keep the stored session in sync.
        sessionRef.current = { ...sessionRef.current, color: view.you };
        saveSession(sessionRef.current);
      }
    });

    socket.on('room:kicked', () => {
      setStatus('kicked');
    });

    socket.on('disconnect', () => setConnected(false));

    socket.on('connect', async () => {
      setConnected(true);
      // First connection or automatic reconnection: try to get our seat back.
      const urlCode = codeFromUrl();
      const known = sessionRef.current ?? loadTabSession(urlCode ?? undefined);
      if (known && (!urlCode || known.code === urlCode)) {
        if (await resume(known)) return;
        sessionRef.current = null;
        if (!urlCode) {
          clearSession();
          setError('Impossible de reprendre la partie (le serveur a peut-être redémarré).');
          setStatus('home');
          return;
        }
      }
      if (urlCode && sessionRef.current === null) {
        await join(urlCode);
        return;
      }
      setStatus((s) => (s === 'connecting' ? 'home' : s));
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [join, resume]);

  const create = useCallback(async () => {
    const socket = socketRef.current;
    if (!socket) return;
    const res = await socket.emitWithAck('room:create');
    if (check(res)) enter(res.data);
  }, [check, enter]);

  const deploy = useCallback(
    async (placements: Placement[]) => {
      const socket = socketRef.current;
      if (!socket) return false;
      return check(await socket.emitWithAck('game:deploy', { placements }));
    },
    [check],
  );

  const act = useCallback(
    async (action: Action) => {
      const socket = socketRef.current;
      if (!socket) return false;
      return check(await socket.emitWithAck('game:action', { action }));
    },
    [check],
  );

  const rematch = useCallback(async () => {
    const socket = socketRef.current;
    if (!socket) return;
    check(await socket.emitWithAck('game:rematch'));
  }, [check]);

  const leave = useCallback(() => {
    sessionRef.current = null;
    clearSession();
    setUrlCode(null);
    setRoom(null);
    setStatus('home');
    // A fresh connection releases the seat cleanly on the server.
    socketRef.current?.disconnect().connect();
  }, []);

  return {
    status,
    connected,
    room,
    error,
    clearError: () => setError(null),
    create,
    join,
    resume,
    deploy,
    act,
    rematch,
    leave,
  };
}
