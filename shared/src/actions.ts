import { opponent, terrainAt } from './board.js';
import { DIRECTIONS, hexAdd, hexDistance, hexKey, hexLabel, hexScale, isAdjacent, isOnBoard, straightDirection } from './hex.js';
import {
  canBeHealed,
  dealDamage,
  enterHex,
  healUnit,
  log,
  reachableHexes,
  resolveDeaths,
  stopsMovement,
} from './mechanics.js';
import {
  armoredDamage,
  attackDamage,
  canTarget,
  effectAt,
  getUnit,
  isReady,
  rangeOf,
  unitAt,
} from './queries.js';
import { endTurn } from './turn.js';
import { RULES, statsOf, unitName } from './units.js';
import type { AbilityId, Action, GameState, Hex, PlayerId, Result, Unit } from './types.js';

/** Action types that count as the unit's single attack of the turn. */
const ATTACK_ACTIONS = new Set<Action['type']>(['attack', 'fireball', 'charge', 'overwatch']);
/** Action types that are class abilities (forbidden while standing in water). */
const ABILITY_ACTIONS = new Set<Action['type']>(['fireball', 'charge', 'overwatch', 'trap', 'heal', 'aidStation', 'banner', 'rally']);

/** Terrain allowed on every hex of a charge, including the starting hex. */
function isChargeTerrain(h: Hex): boolean {
  const t = terrainAt(h);
  return t === 'plain' || t === 'hill' || t === 'ruin';
}

/** Hexes of a straight charge from the knight to `to` (excluding start), or null if not a 1–3 straight line. */
export function chargePath(from: Hex, to: Hex): Hex[] | null {
  const dir = straightDirection(from, to);
  const len = hexDistance(from, to);
  if (dir < 0 || len < 1 || len > 3) return null;
  return Array.from({ length: len }, (_, i) => hexAdd(from, hexScale(DIRECTIONS[dir]!, i + 1)));
}

/** Validates an intent against the current state; returns an error message or null if legal. */
export function validateAction(state: GameState, player: PlayerId, action: Action): string | null {
  if (state.phase !== 'playing') return "La partie n'est pas en phase de jeu.";
  if (state.current !== player) return "Ce n'est pas votre tour.";
  if (action.type === 'endTurn') return null;

  const unit = getUnit(state, action.unitId);
  if (!unit) return 'Pièce introuvable.';
  if (unit.owner !== player) return "Cette pièce ne vous appartient pas.";

  if (action.type === 'rally') {
    if (unit.cls !== 'general' || unit.promoted) return 'Seul le Général d’origine peut rallier.';
    if (state.players[player].rallyUsed) return 'Ralliement déjà utilisé.';
    if (terrainAt(unit.pos) === 'water') return 'Aucune capacité dans l’eau.';
    return null;
  }

  if (state.actionsLeft <= 0) return 'Plus aucune action ce tour.';
  if (unit.actionsUsed >= RULES.maxActionsPerUnit) return 'Cette pièce a déjà agi 2 fois ce tour.';
  if (ATTACK_ACTIONS.has(action.type) && unit.attacked) return 'Cette pièce a déjà attaqué ce tour.';
  if (ABILITY_ACTIONS.has(action.type) && terrainAt(unit.pos) === 'water') return 'Aucune capacité dans l’eau.';

  switch (action.type) {
    case 'move': {
      if (!isOnBoard(action.to)) return 'Case hors plateau.';
      if (!reachableHexes(state, unit, statsOf(unit).move).has(hexKey(action.to))) return 'Case inaccessible.';
      return null;
    }
    case 'attack': {
      const target = getUnit(state, action.targetId);
      if (!target || target.owner === player) return 'Cible invalide.';
      if (!canTarget(unit, target.pos)) return 'Cible hors de portée ou hors de vue.';
      return null;
    }
    case 'entrench':
      return terrainAt(unit.pos) === 'water' ? 'Impossible de se retrancher dans l’eau.' : null;
    case 'fireball': {
      if (unit.cls !== 'mage') return 'Seul le Mage lance une Boule de feu.';
      if (!isReady(state, unit, 'fireball')) return 'Boule de feu en recharge.';
      if (!isOnBoard(action.target) || !canTarget(unit, action.target)) return 'Case hors de portée ou hors de vue.';
      return null;
    }
    case 'charge': {
      if (unit.cls !== 'knight') return 'Seul le Chevalier charge.';
      if (!isReady(state, unit, 'charge')) return 'Charge en recharge.';
      const path = chargePath(unit.pos, action.to);
      if (!path) return 'La charge doit suivre une ligne droite de 1 à 3 cases.';
      if (!isChargeTerrain(unit.pos)) return 'Pas de charge depuis la forêt ou l’eau.';
      for (const [i, h] of path.entries()) {
        if (!isOnBoard(h) || unitAt(state, h)) return 'Trajectoire de charge bloquée.';
        if (!isChargeTerrain(h)) return 'Pas de charge à travers la forêt ou l’eau.';
        if (i < path.length - 1 && stopsMovement(state, unit, h)) return 'La charge serait stoppée avant (ZdC ou piège).';
      }
      const target = getUnit(state, action.targetId);
      if (!target || target.owner === player) return 'Cible invalide.';
      if (!isAdjacent(target.pos, action.to)) return 'La cible doit être adjacente à la case d’arrivée.';
      return null;
    }
    case 'overwatch':
      return unit.cls === 'archer' ? null : 'Seul l’Archer peut tirer en couverture.';
    case 'trap': {
      if (unit.cls !== 'assassin') return 'Seul l’Assassin pose des pièges.';
      if (!isReady(state, unit, 'trap')) return 'Piège en recharge.';
      if (!isOnBoard(action.target) || !isAdjacent(unit.pos, action.target)) return 'Le piège doit être adjacent.';
      if (unitAt(state, action.target)) return 'La case doit être vide.';
      if (effectAt(state, action.target, 'trap')) return 'Il y a déjà un piège ici.';
      if (state.effects.filter((e) => e.kind === 'trap' && e.owner === player).length >= RULES.maxTrapsPerPlayer) {
        return 'Maximum 2 pièges actifs.';
      }
      return null;
    }
    case 'heal': {
      if (unit.cls !== 'medic') return 'Seul l’Infirmier soigne.';
      const target = getUnit(state, action.targetId);
      if (!target || target.owner !== player) return 'Cible invalide.';
      if (target.id !== unit.id && !isAdjacent(unit.pos, target.pos)) return 'La cible doit être adjacente.';
      if (!canBeHealed(state, target)) return 'Cette pièce ne peut pas être soignée (PV max, déjà soignée, feu ou trousse vide).';
      return null;
    }
    case 'aidStation': {
      if (unit.cls !== 'medic') return 'Seul l’Infirmier installe un poste de secours.';
      if (!isReady(state, unit, 'aidStation')) return 'Poste de secours en recharge.';
      if (!isOnBoard(action.target) || hexDistance(unit.pos, action.target) > 1) return 'Case trop éloignée.';
      if (effectAt(state, action.target, 'aidStation')) return 'Il y a déjà un poste ici.';
      return null;
    }
    case 'banner': {
      if (unit.cls !== 'viceGeneral') return 'Seul le Vice-général plante la Bannière.';
      if (!isReady(state, unit, 'banner')) return 'Bannière en recharge.';
      if (!isOnBoard(action.target) || hexDistance(unit.pos, action.target) > RULES.bannerRange) return 'Case trop éloignée.';
      return null;
    }
  }
}

/** Marks an ability as used: unavailable during the owner's next X turns. */
function startCooldown(state: GameState, unit: Unit, ability: AbilityId): void {
  unit.readyAt[ability] = state.turn + 2 * (RULES.cooldown[ability] + 1);
}

/** Adds an effect token on a hex; duration counts the owner's turns, null = until triggered. */
function addEffect(state: GameState, kind: 'fire' | 'trap' | 'aidStation' | 'banner', pos: Hex, duration: number | null): void {
  state.effects = state.effects.filter((e) => !(e.kind === kind && e.pos.q === pos.q && e.pos.r === pos.r));
  state.effects.push({
    id: state.nextEffectId++,
    kind,
    owner: state.current,
    pos: { ...pos },
    expiresAt: duration === null ? null : state.turn + 2 * duration,
  });
}

/** Performs a basic attack (or the attack at the end of a charge). */
function resolveAttack(state: GameState, attacker: Unit, target: Unit, charge: boolean): void {
  const dmg = attackDamage(state, attacker, target, charge);
  const label = charge ? 'charge' : attacker.cls === 'mage' ? 'trait arcanique' : `attaque de ${unitName(attacker)}`;
  dealDamage(state, target, dmg, label);
}

/** Validates then applies an intent; never mutates the input state. */
export function applyAction(state: GameState, player: PlayerId, action: Action): Result<GameState> {
  const error = validateAction(state, player, action);
  if (error) return { ok: false, error };
  const draft = structuredClone(state);
  executeAction(draft, action);
  return { ok: true, state: draft };
}

/** Executes an already-validated action on a draft state. */
function executeAction(state: GameState, action: Action): void {
  if (action.type === 'endTurn') {
    log(state, 'Fin de tour.');
    endTurn(state);
    return;
  }
  const unit = getUnit(state, action.unitId)!;

  if (action.type === 'rally') {
    state.players[unit.owner].rallyUsed = true;
    state.actionsLeft += 1;
    log(state, `${unitName(unit)} lance le Ralliement : +1 action ce tour.`);
    return;
  }

  state.actionsLeft -= 1;
  unit.actionsUsed += 1;
  if (ATTACK_ACTIONS.has(action.type)) unit.attacked = true;

  switch (action.type) {
    case 'move': {
      const route = reachableHexes(state, unit, statsOf(unit).move).get(hexKey(action.to))!;
      log(state, `${unitName(unit)} se déplace de ${hexLabel(unit.pos)} vers ${hexLabel(action.to)}.`);
      for (const h of route.path) {
        if (enterHex(state, unit, h)) break;
      }
      break;
    }
    case 'attack': {
      const target = getUnit(state, action.targetId)!;
      resolveAttack(state, unit, target, false);
      break;
    }
    case 'entrench': {
      unit.entrenched = true;
      unit.actionsUsed = RULES.maxActionsPerUnit;
      log(state, `${unitName(unit)} se retranche (+1 armure).`);
      break;
    }
    case 'fireball': {
      startCooldown(state, unit, 'fireball');
      log(state, `${unitName(unit)} lance une Boule de feu sur ${hexLabel(action.target)}.`);
      const victims = state.units
        .filter((u) => u.hp > 0 && hexDistance(u.pos, action.target) <= 1)
        .map((u) => ({ u, base: hexDistance(u.pos, action.target) === 0 ? RULES.fireballCenterDamage : RULES.fireballSplashDamage }));
      // Damage is computed for every victim before any is applied, so deaths do not change others' armor.
      const hits = victims.map(({ u, base }) => ({ u, dmg: armoredDamage(state, u, base, true) }));
      for (const { u, dmg } of hits) dealDamage(state, u, dmg, 'boule de feu');
      addEffect(state, 'fire', action.target, RULES.duration.fire);
      break;
    }
    case 'charge': {
      startCooldown(state, unit, 'charge');
      const path = chargePath(unit.pos, action.to)!;
      log(state, `${unitName(unit)} charge de ${hexLabel(unit.pos)} vers ${hexLabel(action.to)}.`);
      for (const h of path) {
        if (enterHex(state, unit, h)) break;
      }
      // Validation guarantees only the last hex can stop the charge, so a living knight has arrived.
      const target = getUnit(state, action.targetId);
      if (unit.hp > 0 && target) resolveAttack(state, unit, target, path.length >= 2);
      break;
    }
    case 'overwatch': {
      unit.overwatch = true;
      const { min, max } = rangeOf(unit);
      log(state, `${unitName(unit)} se met en Tir de couverture (portée ${min}–${max}).`);
      break;
    }
    case 'trap': {
      startCooldown(state, unit, 'trap');
      addEffect(state, 'trap', action.target, null);
      log(state, `${unitName(unit)} pose un piège en ${hexLabel(action.target)}.`);
      break;
    }
    case 'heal': {
      const target = getUnit(state, action.targetId)!;
      healUnit(state, target, RULES.healAmount, `soin de ${unitName(unit)}`);
      break;
    }
    case 'aidStation': {
      startCooldown(state, unit, 'aidStation');
      addEffect(state, 'aidStation', action.target, RULES.duration.aidStation);
      log(state, `${unitName(unit)} installe un poste de secours en ${hexLabel(action.target)}.`);
      break;
    }
    case 'banner': {
      startCooldown(state, unit, 'banner');
      state.effects = state.effects.filter((e) => !(e.kind === 'banner' && e.owner === unit.owner));
      addEffect(state, 'banner', action.target, RULES.duration.banner);
      log(state, `${unitName(unit)} plante la Bannière en ${hexLabel(action.target)}.`);
      break;
    }
  }
  resolveDeaths(state);
}

/** Every legal action for one unit, generated by brute force and filtered through validateAction. */
export function legalActionsForUnit(state: GameState, player: PlayerId, unitId: string): Action[] {
  const unit = getUnit(state, unitId);
  if (!unit || unit.owner !== player) return [];
  const enemies = state.units.filter((u) => u.hp > 0 && u.owner === opponent(player));
  const allies = state.units.filter((u) => u.hp > 0 && u.owner === player);
  const around = (radius: number) => {
    const out: Hex[] = [];
    for (let dq = -radius; dq <= radius; dq++) {
      for (let dr = -radius; dr <= radius; dr++) {
        const h = { q: unit.pos.q + dq, r: unit.pos.r + dr };
        if (isOnBoard(h) && hexDistance(h, unit.pos) <= radius) out.push(h);
      }
    }
    return out;
  };
  const candidates: Action[] = [
    ...[...reachableHexes(state, unit, statsOf(unit).move).values()].map((r) => ({ type: 'move' as const, unitId, to: r.path[r.path.length - 1]! })),
    ...enemies.map((e) => ({ type: 'attack' as const, unitId, targetId: e.id })),
    { type: 'entrench', unitId },
    { type: 'overwatch', unitId },
    { type: 'rally', unitId },
    ...around(rangeOf(unit).max).map((h) => ({ type: 'fireball' as const, unitId, target: h })),
    ...DIRECTIONS.flatMap((d) =>
      [1, 2, 3].flatMap((k) => {
        const to = hexAdd(unit.pos, hexScale(d, k));
        return enemies.filter((e) => isAdjacent(e.pos, to)).map((e) => ({ type: 'charge' as const, unitId, to, targetId: e.id }));
      }),
    ),
    ...around(1).map((h) => ({ type: 'trap' as const, unitId, target: h })),
    ...allies.map((a) => ({ type: 'heal' as const, unitId, targetId: a.id })),
    ...around(1).map((h) => ({ type: 'aidStation' as const, unitId, target: h })),
    ...around(RULES.bannerRange).map((h) => ({ type: 'banner' as const, unitId, target: h })),
  ];
  return candidates.filter((a) => validateAction(state, player, a) === null);
}
