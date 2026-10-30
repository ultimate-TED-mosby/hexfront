import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, RoomView, ServerToClientEvents, Session } from '@hexfront/shared';
import { createApp, type App } from '../src/app.js';
import { defaultPlacements } from './helpers.js';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let app: App;
let url: string;
const clients: Client[] = [];

beforeEach(async () => {
  app = createApp();
  await new Promise<void>((resolve) => app.httpServer.listen(0, resolve));
  url = `http://localhost:${(app.httpServer.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  await app.close();
});

/** Opens a connected client. */
async function client(): Promise<Client> {
  const c: Client = connect(url, { transports: ['websocket'], forceNew: true });
  clients.push(c);
  await new Promise<void>((resolve) => c.on('connect', () => resolve()));
  return c;
}

/** Unwraps a successful ack or fails the test. */
function expectOk<T>(res: Ack<T>): T {
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

/** Resolves with the next room:state matching a predicate. */
function nextState(c: Client, predicate: (v: RoomView) => boolean = () => true): Promise<RoomView> {
  return new Promise((resolve) => {
    const handler = (v: RoomView) => {
      if (!predicate(v)) return;
      c.off('room:state', handler);
      resolve(v);
    };
    c.on('room:state', handler);
  });
}

describe('socket flow', () => {
  it('create → join → hidden deployment → reveal → action → reconnect', async () => {
    const host = await client();
    const created = expectOk<Session>(await host.emitWithAck('room:create'));
    const guest = await client();
    const hostSeesGuest = nextState(host, (v) => v.seats.blue.joined && v.seats.red.joined);
    const joined = expectOk<Session>(await guest.emitWithAck('room:join', { code: created.code }));
    expect(joined.color).not.toBe(created.color);
    await hostSeesGuest;

    // Host deploys: the guest must not receive the host's units.
    const guestAfterHostReady = nextState(guest, (v) => v.game.players[created.color].deployed);
    expectOk(await host.emitWithAck('game:deploy', { placements: defaultPlacements(created.color) }));
    expect((await guestAfterHostReady).game.units).toHaveLength(0);

    // Guest deploys: both see 26 units and blue to play.
    const hostRevealed = nextState(host, (v) => v.game.phase === 'playing');
    expectOk(await guest.emitWithAck('game:deploy', { placements: defaultPlacements(joined.color) }));
    const revealed = await hostRevealed;
    expect(revealed.game.units).toHaveLength(26);
    expect(revealed.game.current).toBe('blue');

    // Server rejects an out-of-turn action and a forged one.
    const [blueClient, redClient] = created.color === 'blue' ? [host, guest] : [guest, host];
    const outOfTurn = await redClient.emitWithAck('game:action', { action: { type: 'endTurn' } });
    expect(outOfTurn.ok).toBe(false);
    const forged = await blueClient.emitWithAck('game:action', { action: { type: 'move', unitId: 'red-general-1', to: { q: 0, r: 0 } } });
    expect(forged.ok).toBe(false);
    expectOk(await blueClient.emitWithAck('game:action', { action: { type: 'endTurn' } }));

    // The guest reloads: a new connection resumes the same seat with its token.
    const hostSeesDisconnect = nextState(host, (v) => !v.seats[joined.color].connected);
    guest.disconnect();
    await hostSeesDisconnect;
    const reloaded = await client();
    const resumedState = nextState(reloaded);
    const resumed = expectOk<Session>(await reloaded.emitWithAck('room:resume', { code: joined.code, token: joined.token }));
    expect(resumed.color).toBe(joined.color);
    const view = await resumedState;
    expect(view.you).toBe(joined.color);
    expect(view.game.turn).toBe(2);
  });

  it('kicks the older tab when the same seat is resumed elsewhere', async () => {
    const first = await client();
    const session = expectOk<Session>(await first.emitWithAck('room:create'));
    const kicked = new Promise<string>((resolve) => first.on('room:kicked', resolve));
    const second = await client();
    expectOk(await second.emitWithAck('room:resume', { code: session.code, token: session.token }));
    expect(await kicked).toMatch(/onglet/);
    const stale = await first.emitWithAck('game:action', { action: { type: 'endTurn' } });
    expect(stale.ok).toBe(false);
  });

  it('answers malformed payloads with an error instead of crashing', async () => {
    const c = await client();
    const bad = await c.emitWithAck('room:join', { code: 42 as unknown as string });
    expect(bad.ok).toBe(false);
    const noSeat = await c.emitWithAck('game:deploy', { placements: [] });
    expect(noSeat.ok).toBe(false);
  });

  it('exposes a health check', async () => {
    const res = await fetch(`${url}/healthz`);
    expect(await res.json()).toEqual({ ok: true, rooms: 0 });
  });
});
