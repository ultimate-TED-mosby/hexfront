import { hexEquals, hexKey, isAdjacent, isOnBoard, parseLabel } from './hex.js';
import type { Hex, PlayerId, Terrain } from './types.js';

/** Standard map "Col de l'Aube" from the design doc (central symmetry). */
const TERRAIN_LABELS: Record<Exclude<Terrain, 'plain'>, string[]> = {
  forest: ['C2', 'K8', 'E9', 'I3', 'F4', 'H9'],
  hill: ['G7', 'D5', 'J6', 'F10', 'H3'],
  water: ['G3', 'G11', 'E3', 'I9'],
  ruin: ['D8', 'J3', 'F7', 'H6'],
};

const TERRAIN_MAP: ReadonlyMap<string, Terrain> = new Map(
  (Object.entries(TERRAIN_LABELS) as [Terrain, string[]][]).flatMap(([t, labels]) =>
    labels.map((l) => [hexKey(parseLabel(l)), t] as const),
  ),
);

/** Movement cost of each terrain. */
export const TERRAIN_COST: Record<Terrain, number> = {
  plain: 1,
  forest: 2,
  hill: 2,
  water: 3,
  ruin: 1,
};

/** Command post (QG) of each player. */
export const HQ: Record<PlayerId, Hex> = {
  blue: parseLabel('M4'),
  red: parseLabel('A4'),
};

/** Terrain of a board hex (plain by default). */
export function terrainAt(h: Hex): Terrain {
  return TERRAIN_MAP.get(hexKey(h)) ?? 'plain';
}

/** True if terrain blocks line of sight (forest, ruin). */
export function blocksLineOfSight(t: Terrain): boolean {
  return t === 'forest' || t === 'ruin';
}

/** The opposing player. */
export function opponent(p: PlayerId): PlayerId {
  return p === 'blue' ? 'red' : 'blue';
}

/** True if the hex is a player's QG. */
export function isHqOf(h: Hex, p: PlayerId): boolean {
  return hexEquals(h, HQ[p]);
}

/** True if the hex is one of the ramparts (neighbours) of a player's QG. */
export function isRampartOf(h: Hex, p: PlayerId): boolean {
  return isAdjacent(h, HQ[p]);
}

/** True if the hex is in a player's deployment zone (rows K–M for blue, A–C for red). */
export function isInDeploymentZone(h: Hex, p: PlayerId): boolean {
  if (!isOnBoard(h)) return false;
  return p === 'blue' ? h.r >= 4 : h.r <= -4;
}
