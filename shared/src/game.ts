import { isInDeploymentZone, opponent } from './board.js';
import { hexKey, isOnBoard } from './hex.js';
import { log } from './mechanics.js';
import { startTurn } from './turn.js';
import { RULES, armyRoster, createUnit } from './units.js';
import type { GameState, Placement, PlayerId, Result } from './types.js';

/** Creates a new game in the deployment phase (blue always plays first). */
export function createGame(): GameState {
  return {
    phase: 'deployment',
    turn: 0,
    current: 'blue',
    actionsLeft: 0,
    units: [],
    effects: [],
    players: {
      blue: { deployed: false, kit: RULES.medicKit, rallyUsed: false, disarray: false },
      red: { deployed: false, kit: RULES.medicKit, rallyUsed: false, disarray: false },
    },
    noDamageTurns: 0,
    bloodied: false,
    damageThisTurn: false,
    winner: null,
    endReason: null,
    log: [{ turn: 0, player: null, text: 'Phase de déploiement : placez vos 13 pièces puis validez.' }],
    nextEffectId: 1,
  };
}

/** Validates a full secret deployment: every roster unit once, in the player's zone, on distinct hexes. */
export function validateDeployment(state: GameState, player: PlayerId, placements: Placement[]): string | null {
  if (state.phase !== 'deployment') return "La phase de déploiement est terminée.";
  if (state.players[player].deployed) return 'Déploiement déjà validé.';
  const roster = armyRoster(player);
  if (placements.length !== roster.length) return `Il faut placer exactement ${roster.length} pièces.`;
  const ids = new Set(roster.map((r) => r.unitId));
  const seenIds = new Set<string>();
  const seenHexes = new Set<string>();
  for (const p of placements) {
    if (!ids.has(p.unitId) || seenIds.has(p.unitId)) return `Pièce inconnue ou dupliquée : ${p.unitId}.`;
    if (!isOnBoard(p.pos) || !isInDeploymentZone(p.pos, player)) return 'Une pièce est hors de votre zone de déploiement.';
    if (seenHexes.has(hexKey(p.pos))) return 'Deux pièces sur la même case.';
    seenIds.add(p.unitId);
    seenHexes.add(hexKey(p.pos));
  }
  return null;
}

/** Records a player's deployment; when both are in, reveals them and starts blue's first turn. */
export function applyDeployment(state: GameState, player: PlayerId, placements: Placement[]): Result<GameState> {
  const error = validateDeployment(state, player, placements);
  if (error) return { ok: false, error };
  const draft = structuredClone(state);
  const classes = new Map(armyRoster(player).map((r) => [r.unitId, r.cls]));
  for (const p of placements) draft.units.push(createUnit(p.unitId, player, classes.get(p.unitId)!, p.pos));
  draft.players[player].deployed = true;
  log(draft, `${player === 'blue' ? 'Bleu' : 'Rouge'} est prêt.`, player);
  if (draft.players[opponent(player)].deployed) {
    draft.phase = 'playing';
    draft.turn = 1;
    draft.current = 'blue';
    log(draft, 'Révélation des deux armées !', null);
    startTurn(draft);
  }
  return { ok: true, state: draft };
}

/** View of the state for one player: hides the opponent's units while deployment is still secret. */
export function viewForPlayer(state: GameState, player: PlayerId): GameState {
  if (state.phase !== 'deployment') return state;
  return { ...state, units: state.units.filter((u) => u.owner === player) };
}
