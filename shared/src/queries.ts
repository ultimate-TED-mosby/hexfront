import { blocksLineOfSight, isRampartOf, terrainAt } from './board.js';
import { hexDistance, hexEquals, hexLine, isAdjacent } from './hex.js';
import { RULES, statsOf } from './units.js';
import type { Effect, EffectKind, GameState, Hex, PlayerId, Unit } from './types.js';

/** Living unit standing on a hex, if any. */
export function unitAt(state: GameState, h: Hex): Unit | undefined {
  return state.units.find((u) => u.hp > 0 && hexEquals(u.pos, h));
}

/** Living unit by id, if any. */
export function getUnit(state: GameState, id: string): Unit | undefined {
  return state.units.find((u) => u.id === id && u.hp > 0);
}

/** Effect of a given kind on a hex, optionally restricted to one owner. */
export function effectAt(state: GameState, h: Hex, kind: EffectKind, owner?: PlayerId): Effect | undefined {
  return state.effects.find(
    (e) => e.kind === kind && hexEquals(e.pos, h) && (owner === undefined || e.owner === owner),
  );
}

/** Living units of a player adjacent to a hex. */
export function adjacentUnitsOf(state: GameState, h: Hex, owner: PlayerId): Unit[] {
  return state.units.filter((u) => u.hp > 0 && u.owner === owner && isAdjacent(u.pos, h));
}

/** True if a hex is in the zone of control of an enemy of `owner` (adjacent to any enemy unit). */
export function isInEnemyZoc(state: GameState, h: Hex, owner: PlayerId): boolean {
  return state.units.some((u) => u.hp > 0 && u.owner !== owner && isAdjacent(u.pos, h));
}

/** Line of sight: blocked by an intermediate forest or ruin; on an exact edge the attacker picks the clear side. */
export function hasLineOfSight(from: Hex, to: Hex): boolean {
  if (hexDistance(from, to) <= 1) return true;
  const clear = (line: Hex[]) => line.slice(1, -1).every((h) => !blocksLineOfSight(terrainAt(h)));
  return clear(hexLine(from, to, 1)) || clear(hexLine(from, to, -1));
}

/** Attack range of a unit, including the +1 max range bonus of archers and mages on a hill. */
export function rangeOf(unit: Unit): { min: number; max: number } {
  const s = statsOf(unit);
  const hillBonus = (unit.cls === 'archer' || unit.cls === 'mage') && terrainAt(unit.pos) === 'hill' ? 1 : 0;
  return { min: s.minRange, max: s.maxRange + hillBonus };
}

/** True if `target` is within range of `unit` and visible. */
export function canTarget(unit: Unit, target: Hex): boolean {
  const d = hexDistance(unit.pos, target);
  const { min, max } = rangeOf(unit);
  return d >= min && d <= max && hasLineOfSight(unit.pos, target);
}

/** True if the unit gets +1 armor from an adjacent ally (Formation for soldiers, Presence of a general). */
function hasAllyArmorBonus(state: GameState, unit: Unit): boolean {
  return adjacentUnitsOf(state, unit.pos, unit.owner).some(
    (a) => a.id !== unit.id && (a.cls === 'general' || (unit.cls === 'soldier' && a.cls === 'soldier')),
  );
}

/** Total armor of a unit against an attack (capped at 2, then -1 in water). */
export function armorOf(state: GameState, unit: Unit, ranged: boolean): number {
  const terrain = terrainAt(unit.pos);
  let armor = statsOf(unit).armor;
  if (hasAllyArmorBonus(state, unit)) armor += 1;
  if (terrain === 'ruin') armor += 1;
  if (terrain === 'forest' && ranged) armor += 1;
  if (isRampartOf(unit.pos, unit.owner)) armor += 1;
  if (unit.entrenched) armor += 1;
  armor = Math.min(armor, RULES.armorCap);
  if (terrain === 'water') armor = Math.max(0, armor - 1);
  return armor;
}

/** True if the attacker stands on or next to an active banner of its owner. */
export function hasBanner(state: GameState, attacker: Unit): boolean {
  return state.effects.some(
    (e) => e.kind === 'banner' && e.owner === attacker.owner && hexDistance(e.pos, attacker.pos) <= 1,
  );
}

/** True if the unit has no allied unit adjacent to it (backstab condition). */
export function isIsolated(state: GameState, unit: Unit): boolean {
  return !adjacentUnitsOf(state, unit.pos, unit.owner).some((a) => a.id !== unit.id);
}

/** Damage of a basic attack or charge, after bonuses, hill penalty and armor (min 1). */
export function attackDamage(state: GameState, attacker: Unit, target: Unit, charge = false): number {
  // The mage's basic attack (arcane bolt) is a flat 1 ignoring armor and banners.
  if (attacker.cls === 'mage') return statsOf(attacker).attack;
  const distance = hexDistance(attacker.pos, target.pos);
  const melee = distance === 1;
  let dmg = statsOf(attacker).attack;
  if (charge) dmg += RULES.chargeBonus;
  if (hasBanner(state, attacker)) dmg += RULES.bannerBonus;
  if (attacker.cls === 'assassin' && isIsolated(state, target)) dmg += RULES.backstabBonus;
  if (melee && terrainAt(target.pos) === 'hill' && terrainAt(attacker.pos) !== 'hill') dmg -= RULES.hillMeleePenalty;
  dmg -= armorOf(state, target, !melee);
  return Math.max(RULES.minDamage, dmg);
}

/** Damage of a fixed-value effect where armor applies (fireball, overwatch, trap), min 1. */
export function armoredDamage(state: GameState, target: Unit, base: number, ranged: boolean): number {
  return Math.max(RULES.minDamage, base - armorOf(state, target, ranged));
}

/** True if the ability is off cooldown for this unit. */
export function isReady(state: GameState, unit: Unit, ability: keyof typeof RULES.cooldown): boolean {
  return (unit.readyAt[ability] ?? 0) <= state.turn;
}

/** Sum of the values of a player's living units (used for the points tiebreak). */
export function armyValue(state: GameState, owner: PlayerId): number {
  return state.units
    .filter((u) => u.hp > 0 && u.owner === owner)
    .reduce((sum, u) => sum + statsOf({ ...u, promoted: false }).value, 0);
}
