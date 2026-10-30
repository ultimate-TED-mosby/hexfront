import { describe, expect, it } from 'vitest';
import { opponent } from '@hexfront/shared';
import { RoomManager } from '../src/rooms.js';
import { parseAction, parsePlacements } from '../src/validate.js';
import { defaultPlacements } from './helpers.js';

/** Creates a room with both seats taken; returns the manager and both sessions. */
function fullRoom() {
  const rooms = new RoomManager();
  const a = rooms.create('sock-a');
  if (!a.ok) throw new Error(a.error);
  const b = rooms.join(a.value.code, 'sock-b');
  if (!b.ok) throw new Error(b.error);
  return { rooms, host: a.value, guest: b.value };
}

describe('RoomManager', () => {
  it('creates a 6-character code and gives the guest the other color', () => {
    const { rooms, host, guest } = fullRoom();
    expect(host.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(guest.color).toBe(opponent(host.color));
    expect(rooms.join(host.code, 'sock-c').ok).toBe(false); // room full
    expect(rooms.join('ZZZZZZ', 'sock-c').ok).toBe(false); // unknown
  });

  it('join is case-insensitive', () => {
    const rooms = new RoomManager();
    const a = rooms.create('sock-a');
    if (!a.ok) throw new Error(a.error);
    expect(rooms.join(` ${a.value.code.toLowerCase()} `, 'sock-b').ok).toBe(true);
  });

  it('resumes a seat with its token only, and reports the replaced socket', () => {
    const { rooms, host } = fullRoom();
    expect(rooms.resume(host.code, 'wrong-token', 'sock-x').ok).toBe(false);
    const res = rooms.resume(host.code, host.token, 'sock-x');
    expect(res.ok && res.value.replaced).toBe('sock-a');
    expect(res.ok && res.value.session.color).toBe(host.color);
  });

  it('hides the opponent deployment until both are ready', () => {
    const { rooms, host, guest } = fullRoom();
    const room = rooms.get(host.code)!;
    expect(rooms.deploy(host.code, host.color, defaultPlacements(host.color)).ok).toBe(true);
    expect(rooms.viewFor(room, guest.color).game.units).toHaveLength(0);
    expect(rooms.viewFor(room, host.color).game.units).toHaveLength(13);
    expect(rooms.deploy(guest.code, guest.color, defaultPlacements(guest.color)).ok).toBe(true);
    expect(rooms.viewFor(room, guest.color).game.units).toHaveLength(26);
    expect(room.game.phase).toBe('playing');
  });

  it('refuses deployment before the opponent has joined', () => {
    const rooms = new RoomManager();
    const a = rooms.create('sock-a');
    if (!a.ok) throw new Error(a.error);
    expect(rooms.deploy(a.value.code, a.value.color, defaultPlacements(a.value.color)).ok).toBe(false);
  });

  it('validates actions server-side: only the current player may act', () => {
    const { rooms, host, guest } = fullRoom();
    rooms.deploy(host.code, host.color, defaultPlacements(host.color));
    rooms.deploy(guest.code, guest.color, defaultPlacements(guest.color));
    const red = host.color === 'red' ? host : guest;
    const blue = host.color === 'blue' ? host : guest;
    expect(rooms.act(red.code, 'red', { type: 'endTurn' }).ok).toBe(false);
    expect(rooms.act(blue.code, 'blue', { type: 'endTurn' }).ok).toBe(true);
    expect(rooms.get(blue.code)!.game.current).toBe('red');
  });

  it('rematch needs both votes and swaps colors', () => {
    const { rooms, host } = fullRoom();
    const room = rooms.get(host.code)!;
    expect(rooms.voteRematch(host.code, 'blue').ok).toBe(false); // game not finished
    room.game.phase = 'finished';
    const blueToken = room.seats.blue!.token;
    const first = rooms.voteRematch(host.code, 'blue');
    expect(first.ok && first.value.restarted).toBe(false);
    const second = rooms.voteRematch(host.code, 'red');
    expect(second.ok && second.value.restarted).toBe(true);
    expect(room.seats.red!.token).toBe(blueToken);
    expect(room.game.phase).toBe('deployment');
  });

  it('sweeps idle rooms with nobody connected', () => {
    let now = 0;
    const rooms = new RoomManager({ idleTtlMs: 1000, now: () => now });
    const a = rooms.create('sock-a');
    if (!a.ok) throw new Error(a.error);
    now = 5000;
    expect(rooms.sweep()).toBe(0); // creator still connected
    rooms.disconnect(a.value.code, 'sock-a');
    now = 10_000;
    expect(rooms.sweep()).toBe(1);
    expect(rooms.size).toBe(0);
  });

  it('caps the number of rooms', () => {
    const rooms = new RoomManager({ maxRooms: 1 });
    expect(rooms.create('a').ok).toBe(true);
    expect(rooms.create('b').ok).toBe(false);
  });
});

describe('payload validation', () => {
  it('rebuilds well-formed actions and drops unknown fields', () => {
    expect(parseAction({ action: { type: 'move', unitId: 'blue-knight-1', to: { q: 1, r: 2 }, hp: 99 } })).toEqual({
      type: 'move',
      unitId: 'blue-knight-1',
      to: { q: 1, r: 2 },
    });
    expect(parseAction({ action: { type: 'endTurn' } })).toEqual({ type: 'endTurn' });
  });

  it('rejects malformed payloads', () => {
    expect(parseAction(null)).toBeNull();
    expect(parseAction({ action: { type: 'move', unitId: 'x', to: { q: 1.5, r: 0 } } })).toBeNull();
    expect(parseAction({ action: { type: 'teleport', unitId: 'x' } })).toBeNull();
    expect(parsePlacements({ placements: 'nope' })).toBeNull();
    expect(parsePlacements({ placements: [{ unitId: 'a', pos: { q: 'x', r: 0 } }] })).toBeNull();
  });
});
