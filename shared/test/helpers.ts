import { expect } from 'vitest';
import { applyAction, createGame, createUnit, parseLabel } from '../src/index.js';
import type { Action, GameState, PlayerId, Unit, UnitClass } from '../src/index.js';

export interface UnitSpec {
  id: string;
  owner: PlayerId;
  cls: UnitClass;
  at: string;
  hp?: number;
}

/** Builds a mid-game state (turn 3, blue to play, 3 actions) with only the given units. */
export function setup(specs: UnitSpec[], overrides: Partial<GameState> = {}): GameState {
  const state = createGame();
  state.phase = 'playing';
  state.turn = 3;
  state.current = 'blue';
  state.actionsLeft = 3;
  state.players.blue.deployed = true;
  state.players.red.deployed = true;
  state.units = specs.map((s) => {
    const u = createUnit(s.id, s.owner, s.cls, parseLabel(s.at));
    if (s.hp !== undefined) u.hp = s.hp;
    return u;
  });
  return { ...state, ...overrides };
}

/** Applies an action that must be legal and returns the new state. */
export function act(state: GameState, player: PlayerId, action: Action): GameState {
  const res = applyAction(state, player, action);
  if (!res.ok) throw new Error(`Unexpected rejection: ${res.error}`);
  return res.state;
}

/** Asserts that an action is rejected. */
export function rejects(state: GameState, player: PlayerId, action: Action): void {
  const res = applyAction(state, player, action);
  expect(res.ok).toBe(false);
}

/** Finds a living unit by id (throws if dead). */
export function unit(state: GameState, id: string): Unit {
  const u = state.units.find((x) => x.id === id);
  if (!u) throw new Error(`Unit ${id} not found`);
  return u;
}

/** Shorthand for parseLabel. */
export const at = parseLabel;
