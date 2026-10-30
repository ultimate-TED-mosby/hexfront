import { TERRAIN_COST, opponent, terrainAt } from './board.js';
import { hexDistance, hexKey, hexLabel, neighbors } from './hex.js';
import { armoredDamage, effectAt, hasLineOfSight, isInEnemyZoc, rangeOf, unitAt } from './queries.js';
import { RULES, unitName } from './units.js';
import type { EndReason, GameState, Hex, PlayerId, Unit } from './types.js';

// Internal mutators: they modify a draft state that applyAction() has already cloned.

/** Appends a line to the game log. */
export function log(state: GameState, text: string, player: PlayerId | null = state.current): void {
  state.log.push({ turn: state.turn, player, text });
}

/** True once the game is over (a function call avoids stale type narrowing after mutations). */
export function isOver(state: GameState): boolean {
  return state.phase === 'finished';
}

/** Ends the game with a winner (or null for a draw) and a reason. */
export function finish(state: GameState, winner: PlayerId | null, reason: EndReason): void {
  if (state.phase === 'finished') return;
  state.phase = 'finished';
  state.winner = winner;
  state.endReason = reason;
  const why: Record<EndReason, string> = {
    decapitation: 'Général adverse éliminé',
    capture: 'QG adverse capturé et tenu un tour',
    selfDecapitation: 'auto-décapitation adverse',
    points: 'décompte des points',
    draw: 'égalité',
  };
  log(state, winner ? `Victoire ${winner === 'blue' ? 'Bleu' : 'Rouge'} : ${why[reason]}.` : 'Partie nulle.', null);
}

/** Applies damage to a unit, enforcing the general's 4 HP per enemy turn cap; returns damage actually dealt. */
export function dealDamage(state: GameState, unit: Unit, amount: number, source: string): number {
  if (unit.hp <= 0 || amount <= 0) return 0;
  let dmg = amount;
  if (unit.cls === 'general' && state.current !== unit.owner) {
    if (unit.damageTurn !== state.turn) {
      unit.damageTurn = state.turn;
      unit.damageTaken = 0;
    }
    dmg = Math.min(dmg, RULES.generalDamageCapPerTurn - unit.damageTaken);
    unit.damageTaken += dmg;
  }
  if (dmg <= 0) {
    log(state, `${unitName(unit)} : la Cuirasse de commandement absorbe ${source}.`);
    return 0;
  }
  unit.hp = Math.max(0, unit.hp - dmg);
  state.damageThisTurn = true;
  log(state, `${unitName(unit)} subit ${dmg} dégât(s) (${source}) → ${unit.hp}/${unit.maxHp} PV.`);
  return dmg;
}

/** Heals a unit from the player's medic kit (one heal per unit per turn); returns HP restored. */
export function healUnit(state: GameState, unit: Unit, amount: number, source: string): number {
  const kit = state.players[unit.owner];
  const heal = Math.min(amount, unit.maxHp - unit.hp, kit.kit);
  if (heal <= 0) return 0;
  unit.hp += heal;
  kit.kit -= heal;
  unit.lastHealedTurn = state.turn;
  log(state, `${unitName(unit)} récupère ${heal} PV (${source}) → ${unit.hp}/${unit.maxHp}. Trousse : ${kit.kit}.`);
  return heal;
}

/** True if a unit could currently receive a heal (wounded, not healed this turn, not on fire, kit not empty). */
export function canBeHealed(state: GameState, unit: Unit): boolean {
  return (
    unit.hp > 0 &&
    unit.hp < unit.maxHp &&
    unit.lastHealedTurn !== state.turn &&
    state.players[unit.owner].kit > 0 &&
    !effectAt(state, unit.pos, 'fire')
  );
}

/** Enemy archers whose armed overwatch covers a hex for a unit of `owner`, ordered by id. */
export function overwatchersCovering(state: GameState, h: Hex, owner: PlayerId): Unit[] {
  return state.units
    .filter((a) => a.hp > 0 && a.owner !== owner && a.overwatch)
    .filter((a) => {
      const d = hexDistance(a.pos, h);
      const { min, max } = rangeOf(a);
      return d >= min && d <= max && hasLineOfSight(a.pos, h);
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Resolves entering a hex: trap, then overwatch, then fire. Returns true if the movement must stop. */
export function enterHex(state: GameState, unit: Unit, h: Hex): boolean {
  unit.pos = { ...h };
  let stop = false;
  const trap = effectAt(state, h, 'trap', opponent(unit.owner));
  if (trap) {
    state.effects = state.effects.filter((e) => e.id !== trap.id);
    log(state, `${unitName(unit)} déclenche un piège en ${hexLabel(h)}.`);
    dealDamage(state, unit, armoredDamage(state, unit, RULES.trapDamage, false), 'piège');
    stop = true;
  }
  for (const archer of overwatchersCovering(state, h, unit.owner)) {
    if (unit.hp <= 0) break;
    archer.overwatch = false;
    log(state, `Tir de couverture de ${unitName(archer)} sur ${hexLabel(h)}.`);
    dealDamage(state, unit, armoredDamage(state, unit, RULES.overwatchDamage, true), 'tir de couverture');
  }
  if (unit.hp > 0 && effectAt(state, h, 'fire')) {
    dealDamage(state, unit, RULES.fireDamage, 'feu');
  }
  return stop || unit.hp <= 0;
}

export interface Reachable {
  cost: number;
  hazard: number;
  path: Hex[];
}

/** Hazard score of entering a hex (fire, enemy trap, overwatch exposure), used only to break path ties. */
function hazardOf(state: GameState, h: Hex, owner: PlayerId): number {
  let hz = 0;
  if (effectAt(state, h, 'fire')) hz += 1;
  if (effectAt(state, h, 'trap', opponent(owner))) hz += 1;
  hz += overwatchersCovering(state, h, owner).length;
  return hz;
}

/** Hexes a unit can reach with one move action, with the cheapest (then safest) path to each. */
export function reachableHexes(state: GameState, unit: Unit, move: number): Map<string, Reachable> {
  const start = unit.pos;
  const best = new Map<string, Reachable>([[hexKey(start), { cost: 0, hazard: 0, path: [] }]]);
  const queue: { h: Hex; node: Reachable }[] = [{ h: start, node: best.get(hexKey(start))! }];
  const better = (a: Reachable, b: Reachable) =>
    a.cost !== b.cost ? a.cost < b.cost : a.hazard !== b.hazard ? a.hazard < b.hazard : a.path.length < b.path.length;
  while (queue.length > 0) {
    queue.sort((a, b) => (better(a.node, b.node) ? -1 : 1));
    const { h, node } = queue.shift()!;
    if (best.get(hexKey(h)) !== node) continue;
    const isStart = node.path.length === 0;
    if (!isStart && stopsMovement(state, unit, h)) continue;
    for (const n of neighbors(h)) {
      if (unitAt(state, n)) continue;
      const cost = node.cost + TERRAIN_COST[terrainAt(n)];
      // A unit can always advance at least one hex per move action, whatever the cost.
      if (cost > move && !isStart) continue;
      const next: Reachable = { cost, hazard: node.hazard + hazardOf(state, n, unit.owner), path: [...node.path, n] };
      const prev = best.get(hexKey(n));
      if (!prev || better(next, prev)) {
        best.set(hexKey(n), next);
        queue.push({ h: n, node: next });
      }
    }
  }
  best.delete(hexKey(start));
  return best;
}

/** True if entering this hex ends the unit's movement (enemy zone of control unless assassin, or enemy trap). */
export function stopsMovement(state: GameState, unit: Unit, h: Hex): boolean {
  if (effectAt(state, h, 'trap', opponent(unit.owner))) return true;
  return unit.cls !== 'assassin' && isInEnemyZoc(state, h, unit.owner);
}

/** Removes dead units, handles succession and checks decapitation victory. */
export function resolveDeaths(state: GameState): void {
  const dead = state.units.filter((u) => u.hp <= 0);
  if (dead.length === 0) return;
  for (const u of dead) log(state, `${unitName(u)} est éliminé.`);
  state.units = state.units.filter((u) => u.hp > 0);

  const beheaded: PlayerId[] = [];
  for (const p of ['blue', 'red'] as const) {
    if (!dead.some((u) => u.owner === p && u.cls === 'general')) continue;
    const vice = state.units.find((u) => u.owner === p && u.cls === 'viceGeneral');
    if (vice) {
      vice.cls = 'general';
      vice.promoted = true;
      vice.maxHp = 5;
      vice.hp = Math.min(vice.hp, vice.maxHp);
      state.players[p].disarray = true;
      state.players[p].rallyUsed = true;
      log(state, `Succession : ${unitName(vice)} prend le commandement (2 actions au prochain tour).`, p);
    } else {
      beheaded.push(p);
    }
  }
  if (beheaded.length === 2) finish(state, opponent(state.current), 'selfDecapitation');
  else if (beheaded.length === 1) finish(state, opponent(beheaded[0]!), 'decapitation');
}
