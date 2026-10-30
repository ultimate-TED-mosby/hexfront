import { HQ, isHqOf, opponent } from './board.js';
import { hexEquals, hexLabel } from './hex.js';
import { canBeHealed, dealDamage, finish, healUnit, isOver, log, resolveDeaths } from './mechanics.js';
import { armyValue, effectAt } from './queries.js';
import { RULES, unitName } from './units.js';
import type { GameState, PlayerId } from './types.js';

/** True if `player` holds the enemy QG with a non-assassin unit. */
export function checkCapture(state: GameState, player: PlayerId): boolean {
  return state.units.some(
    (u) => u.hp > 0 && u.owner === player && u.cls !== 'assassin' && hexEquals(u.pos, HQ[opponent(player)]),
  );
}

/** Start-of-turn sequence for state.current: expirations, QG salvo, capture check, fire, aid stations, action budget. */
export function startTurn(state: GameState): void {
  const p = state.current;
  log(state, `— Tour ${state.turn} : ${p === 'blue' ? 'Bleu' : 'Rouge'} —`);

  // 1. Expire this player's effects, overwatch and entrenchment; reset per-turn counters.
  state.effects = state.effects.filter((e) => !(e.owner === p && e.expiresAt !== null && e.expiresAt <= state.turn));
  for (const u of state.units) {
    if (u.owner !== p) continue;
    u.overwatch = false;
    u.entrenched = false;
    u.actionsUsed = 0;
    u.attacked = false;
  }

  // 2. QG salvo on enemy units standing on this player's QG.
  for (const u of state.units.filter((x) => x.owner !== p && isHqOf(x.pos, p))) {
    dealDamage(state, u, RULES.hqSalvoDamage, `salve du QG ${hexLabel(HQ[p])}`);
  }
  resolveDeaths(state);
  if (isOver(state)) return;

  // 3. Capture victory: a unit survived a full enemy turn on the enemy QG.
  if (checkCapture(state, p)) {
    log(state, `Le QG ${hexLabel(HQ[opponent(p)])} est tenu un tour complet.`);
    finish(state, p, 'capture');
    return;
  }

  // 4. Fire damage, then aid stations, on this player's units.
  for (const u of state.units.filter((x) => x.owner === p)) {
    if (effectAt(state, u.pos, 'fire')) dealDamage(state, u, RULES.fireDamage, 'feu');
  }
  for (const u of state.units.filter((x) => x.owner === p && x.hp > 0)) {
    if (effectAt(state, u.pos, 'aidStation', p) && canBeHealed(state, u)) {
      healUnit(state, u, RULES.aidStationHeal, 'poste de secours');
    }
  }
  resolveDeaths(state);
  if (isOver(state)) return;

  // 5. Action budget: 2 on blue's very first turn or after a succession, else 3.
  const player = state.players[p];
  if (state.turn === 1) state.actionsLeft = RULES.firstTurnActions;
  else if (player.disarray) state.actionsLeft = RULES.disarrayActions;
  else state.actionsLeft = RULES.actionsPerTurn;
  player.disarray = false;
}

/** End-of-turn sequence: garrison penalty, stall/turn-limit checks, then hand over to the opponent. */
export function endTurn(state: GameState): void {
  const p = state.current;

  // Garrison rule: a unit left on its own QG takes 2 damage.
  for (const u of state.units.filter((x) => x.owner === p && isHqOf(x.pos, p))) {
    log(state, `${unitName(u)} est resté sur son propre QG (garnison interdite).`);
    dealDamage(state, u, RULES.garrisonDamage, 'garnison');
  }
  resolveDeaths(state);
  if (isOver(state)) return;

  // The anti-stall counter only starts after the first damage, so a slow opening is never a draw.
  if (state.damageThisTurn) state.bloodied = true;
  state.noDamageTurns = state.damageThisTurn || !state.bloodied ? 0 : state.noDamageTurns + 1;
  if (state.turn >= RULES.maxTurns || state.noDamageTurns >= RULES.noDamageTurnLimit) {
    log(state, state.turn >= RULES.maxTurns ? 'Limite de tours atteinte : décompte.' : '10 tours sans dégâts : décompte.', null);
    endByPoints(state);
    return;
  }

  state.turn += 1;
  state.current = opponent(p);
  state.damageThisTurn = false;
  startTurn(state);
}

/** Ends the game by comparing army values; equal values give a draw. */
export function endByPoints(state: GameState): void {
  const blue = armyValue(state, 'blue');
  const red = armyValue(state, 'red');
  log(state, `Décompte : Bleu ${blue} – Rouge ${red}.`, null);
  if (blue === red) finish(state, null, 'draw');
  else finish(state, blue > red ? 'blue' : 'red', 'points');
}
