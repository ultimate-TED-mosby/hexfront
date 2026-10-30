import type { Hex, PlayerId, Unit, UnitClass, UnitStats } from './types.js';

/** Stat table from the design doc (section 3.6). */
export const UNIT_STATS: Record<UnitClass, UnitStats> = {
  soldier: { maxHp: 4, move: 2, minRange: 1, maxRange: 1, attack: 2, armor: 0, value: 1 },
  archer: { maxHp: 3, move: 2, minRange: 2, maxRange: 4, attack: 2, armor: 0, value: 2 },
  mage: { maxHp: 3, move: 2, minRange: 1, maxRange: 3, attack: 1, armor: 0, value: 3 },
  knight: { maxHp: 6, move: 3, minRange: 1, maxRange: 1, attack: 3, armor: 1, value: 3 },
  assassin: { maxHp: 3, move: 3, minRange: 1, maxRange: 1, attack: 2, armor: 0, value: 3 },
  medic: { maxHp: 3, move: 2, minRange: 1, maxRange: 1, attack: 1, armor: 0, value: 2 },
  viceGeneral: { maxHp: 5, move: 2, minRange: 1, maxRange: 1, attack: 2, armor: 1, value: 4 },
  general: { maxHp: 7, move: 2, minRange: 1, maxRange: 1, attack: 3, armor: 1, value: 5 },
};

/** French display names for logs and UI. */
export const UNIT_NAMES: Record<UnitClass, string> = {
  soldier: 'Soldat',
  archer: 'Archer',
  mage: 'Mage',
  knight: 'Chevalier',
  assassin: 'Assassin',
  medic: 'Infirmier',
  viceGeneral: 'Vice-général',
  general: 'Général',
};

/** Army composition: 13 units per player. */
export const ARMY_COMPOSITION: readonly [UnitClass, number][] = [
  ['general', 1],
  ['viceGeneral', 1],
  ['knight', 2],
  ['mage', 1],
  ['assassin', 1],
  ['archer', 2],
  ['medic', 1],
  ['soldier', 4],
];

/** Game-wide numeric constants (design doc garde-fous). */
export const RULES = {
  actionsPerTurn: 3,
  firstTurnActions: 2,
  disarrayActions: 2,
  maxActionsPerUnit: 2,
  armorCap: 2,
  minDamage: 1,
  generalDamageCapPerTurn: 4,
  medicKit: 10,
  healAmount: 2,
  aidStationHeal: 1,
  hqSalvoDamage: 2,
  garrisonDamage: 2,
  fireDamage: 1,
  fireballCenterDamage: 2,
  fireballSplashDamage: 1,
  overwatchDamage: 2,
  trapDamage: 2,
  maxTrapsPerPlayer: 2,
  backstabBonus: 2,
  chargeBonus: 1,
  bannerBonus: 1,
  bannerRange: 2,
  hillMeleePenalty: 1,
  maxTurns: 60,
  noDamageTurnLimit: 10,
  cooldown: { fireball: 1, charge: 1, trap: 1, aidStation: 3, banner: 1 },
  duration: { fire: 2, aidStation: 2, banner: 1 },
} as const;

/** Effective stats of a unit (a promoted vice-general keeps its own stats). */
export function statsOf(unit: Unit): UnitStats {
  return unit.promoted ? UNIT_STATS.viceGeneral : UNIT_STATS[unit.cls];
}

/** Ordered roster (ids and classes) of a player's army, e.g. "blue-soldier-1". */
export function armyRoster(owner: PlayerId): { unitId: string; cls: UnitClass }[] {
  return ARMY_COMPOSITION.flatMap(([cls, count]) =>
    Array.from({ length: count }, (_, i) => ({ unitId: `${owner}-${cls}-${i + 1}`, cls })),
  );
}

/** Creates a fresh unit at full health. */
export function createUnit(id: string, owner: PlayerId, cls: UnitClass, pos: Hex): Unit {
  const maxHp = UNIT_STATS[cls].maxHp;
  return {
    id,
    owner,
    cls,
    pos: { ...pos },
    hp: maxHp,
    maxHp,
    promoted: false,
    actionsUsed: 0,
    attacked: false,
    entrenched: false,
    overwatch: false,
    readyAt: {},
    lastHealedTurn: 0,
    damageTurn: 0,
    damageTaken: 0,
  };
}

/** Display name of a unit, e.g. "Chevalier bleu". */
export function unitName(unit: Unit): string {
  const base = unit.promoted ? 'Général (ex-Vice-général)' : UNIT_NAMES[unit.cls];
  return `${base} ${unit.owner === 'blue' ? 'bleu' : 'rouge'}`;
}
