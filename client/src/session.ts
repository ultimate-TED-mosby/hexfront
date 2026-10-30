// Where the client keeps its seat credentials between reloads.
// sessionStorage is per tab, so two tabs of the same browser can play against each other;
// localStorage only remembers the last game to offer "Reprendre" on the home screen.
import type { Session } from '@hexfront/shared';

const TAB_KEY = 'hexfront:session';
const LAST_KEY = 'hexfront:last-session';

/** Reads JSON from a storage, ignoring blocked or corrupted storage. */
function read(storage: () => Storage, key: string): Session | null {
  try {
    const raw = storage().getItem(key);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

/** Writes JSON to a storage, ignoring blocked storage. */
function write(storage: () => Storage, key: string, value: Session | null): void {
  try {
    if (value) storage().setItem(key, JSON.stringify(value));
    else storage().removeItem(key);
  } catch {
    // Private mode or blocked storage: reconnection after reload will simply not be available.
  }
}

/** Session of this tab, if it belongs to the given game code (or any game when code is omitted). */
export function loadTabSession(code?: string): Session | null {
  const s = read(() => sessionStorage, TAB_KEY);
  return s && (!code || s.code === code) ? s : null;
}

/** Last game played in this browser (any tab). */
export function loadLastSession(): Session | null {
  return read(() => localStorage, LAST_KEY);
}

/** Remembers the seat for this tab and as the browser's last game. */
export function saveSession(s: Session): void {
  write(() => sessionStorage, TAB_KEY, s);
  write(() => localStorage, LAST_KEY, s);
}

/** Forgets the seat (game finished, or user went back home). */
export function clearSession(): void {
  write(() => sessionStorage, TAB_KEY, null);
  write(() => localStorage, LAST_KEY, null);
}

/** Game code from the URL (?game=CODE), if any. */
export function codeFromUrl(): string | null {
  const code = new URLSearchParams(window.location.search).get('game');
  return code ? code.trim().toUpperCase() : null;
}

/** Puts ?game=CODE in the address bar (or removes it) without reloading. */
export function setUrlCode(code: string | null): void {
  const url = new URL(window.location.href);
  if (code) url.searchParams.set('game', code);
  else url.searchParams.delete('game');
  window.history.replaceState(null, '', url);
}

/** Shareable invitation link for a game. */
export function inviteLink(code: string): string {
  return `${window.location.origin}/?game=${code}`;
}
