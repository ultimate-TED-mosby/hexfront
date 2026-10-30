// Core data types shared by the server (authoritative) and the client (display only).

export type PlayerId = 'blue' | 'red';

export type UnitClass =
  | 'soldier'
  | 'archer'
  | 'mage'
  | 'knight'
  | 'assassin'
  | 'medic'
  | 'viceGeneral'
  | 'general';

export type Terrain = 'plain' | 'forest' | 'hill' | 'water' | 'ruin';

export type Phase = 'deployment' | 'playing' | 'finished';

/** Axial hex coordinates (pointy-top). r = -6 is row A (north, red), r = 6 is row M (south, blue). */
export interface Hex {
  q: number;
  r: number;
}

export interface UnitStats {
  maxHp: number;
  move: number;
  minRange: number;
  maxRange: number;
  attack: number;
  armor: number;
  value: number;
}

export type AbilityId = 'fireball' | 'charge' | 'trap' | 'aidStation' | 'banner';

export interface Unit {
  id: string;
  owner: PlayerId;
  cls: UnitClass;
  pos: Hex;
  hp: number;
  maxHp: number;
  /** True for a vice-general promoted to general by succession. */
  promoted: boolean;
  /** Actions spent by this unit during the current turn (max 2). */
  actionsUsed: number;
  /** Whether this unit already performed an attack-type action this turn (max 1). */
  attacked: boolean;
  /** +1 armor until the start of its owner's next turn. */
  entrenched: boolean;
  /** Archer only: overwatch armed until triggered or until its owner's next turn. */
  overwatch: boolean;
  /** Turn number from which each ability is usable again. */
  readyAt: Partial<Record<AbilityId, number>>;
  /** Turn number of the last heal received (one heal per turn). */
  lastHealedTurn: number;
  /** Turn number and amount used by the general's damage cap. */
  damageTurn: number;
  damageTaken: number;
}

export type EffectKind = 'fire' | 'trap' | 'aidStation' | 'banner';

export interface Effect {
  id: number;
  kind: EffectKind;
  owner: PlayerId;
  pos: Hex;
  /** Removed at the start of the owner's turn whose number is >= expiresAt. null = until triggered. */
  expiresAt: number | null;
}

export interface PlayerState {
  deployed: boolean;
  /** Remaining medic healing points for the whole game. */
  kit: number;
  rallyUsed: boolean;
  /** Set when the general died: the next turn of this player has only 2 actions. */
  disarray: boolean;
}

export type EndReason =
  | 'decapitation'
  | 'capture'
  | 'selfDecapitation'
  | 'points'
  | 'draw';

export interface LogEntry {
  turn: number;
  player: PlayerId | null;
  text: string;
}

export interface GameState {
  phase: Phase;
  /** Global half-turn counter: blue plays odd turns, red plays even turns. */
  turn: number;
  current: PlayerId;
  actionsLeft: number;
  units: Unit[];
  effects: Effect[];
  players: Record<PlayerId, PlayerState>;
  /** Consecutive turns without any damage dealt, counted only once the first damage of the game happened. */
  noDamageTurns: number;
  /** True once any damage has been dealt in this game (starts the no-damage counter). */
  bloodied: boolean;
  damageThisTurn: boolean;
  winner: PlayerId | null;
  endReason: EndReason | null;
  log: LogEntry[];
  nextEffectId: number;
}

export interface Placement {
  unitId: string;
  pos: Hex;
}

export type Action =
  | { type: 'move'; unitId: string; to: Hex }
  | { type: 'attack'; unitId: string; targetId: string }
  | { type: 'entrench'; unitId: string }
  | { type: 'fireball'; unitId: string; target: Hex }
  | { type: 'charge'; unitId: string; to: Hex; targetId: string }
  | { type: 'overwatch'; unitId: string }
  | { type: 'trap'; unitId: string; target: Hex }
  | { type: 'heal'; unitId: string; targetId: string }
  | { type: 'aidStation'; unitId: string; target: Hex }
  | { type: 'banner'; unitId: string; target: Hex }
  | { type: 'rally'; unitId: string }
  | { type: 'endTurn' };

export type ActionType = Action['type'];

export type Result<T> = { ok: true; state: T } | { ok: false; error: string };
