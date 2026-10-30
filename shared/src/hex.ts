import type { Hex } from './types.js';

export const BOARD_RADIUS = 6;
const ROWS = 'ABCDEFGHIJKLM';

/** The six axial directions, clockwise from east. */
export const DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

/** Builds a hex value. */
export function hex(q: number, r: number): Hex {
  return { q, r };
}

/** Stable string key for maps and sets. */
export function hexKey(h: Hex): string {
  return `${h.q},${h.r}`;
}

/** Structural equality of two hexes. */
export function hexEquals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

/** Adds two hex vectors. */
export function hexAdd(a: Hex, b: Hex): Hex {
  return { q: a.q + b.q, r: a.r + b.r };
}

/** Multiplies a hex vector by an integer. */
export function hexScale(a: Hex, k: number): Hex {
  return { q: a.q * k, r: a.r * k };
}

/** Hex distance in steps. */
export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** True if the hex lies on the radius-6 hexagonal board (127 cells). */
export function isOnBoard(h: Hex): boolean {
  return (
    Math.abs(h.q) <= BOARD_RADIUS &&
    Math.abs(h.r) <= BOARD_RADIUS &&
    Math.abs(h.q + h.r) <= BOARD_RADIUS
  );
}

/** On-board neighbours of a hex. */
export function neighbors(h: Hex): Hex[] {
  return DIRECTIONS.map((d) => hexAdd(h, d)).filter(isOnBoard);
}

/** True if the two hexes share an edge. */
export function isAdjacent(a: Hex, b: Hex): boolean {
  return hexDistance(a, b) === 1;
}

/** All 127 board hexes, row by row from A to M. */
export function allHexes(): Hex[] {
  const out: Hex[] = [];
  for (let r = -BOARD_RADIUS; r <= BOARD_RADIUS; r++) {
    for (let q = Math.max(-BOARD_RADIUS, -BOARD_RADIUS - r); q <= Math.min(BOARD_RADIUS, BOARD_RADIUS - r); q++) {
      out.push({ q, r });
    }
  }
  return out;
}

/** Human label used in the design doc, e.g. "M4" (row letter + 1-based index in the row). */
export function hexLabel(h: Hex): string {
  const qMin = Math.max(-BOARD_RADIUS, -BOARD_RADIUS - h.r);
  return `${ROWS[h.r + BOARD_RADIUS]}${h.q - qMin + 1}`;
}

/** Parses a label such as "G7" back to axial coordinates. */
export function parseLabel(label: string): Hex {
  const r = ROWS.indexOf(label.charAt(0).toUpperCase()) - BOARD_RADIUS;
  const index = Number.parseInt(label.slice(1), 10);
  const qMin = Math.max(-BOARD_RADIUS, -BOARD_RADIUS - r);
  const h = { q: qMin + index - 1, r };
  if (r < -BOARD_RADIUS || Number.isNaN(index) || !isOnBoard(h) || hexLabel(h) !== label.toUpperCase()) {
    throw new Error(`Invalid hex label: ${label}`);
  }
  return h;
}

/** Rounds fractional cube coordinates to the nearest hex. */
function cubeRound(x: number, z: number): Hex {
  const y = -x - z;
  let rx = Math.round(x);
  const ry = Math.round(y);
  let rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy <= dz) rz = -rx - ry;
  return { q: rx, r: rz };
}

/** Hexes crossed by a straight line from a to b, nudged by +eps or -eps to break edge ties. */
export function hexLine(a: Hex, b: Hex, nudge: 1 | -1 = 1): Hex[] {
  const n = hexDistance(a, b);
  const eps = 1e-6 * nudge;
  const out: Hex[] = [];
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    const q = a.q + (b.q - a.q) * t + eps;
    const r = a.r + (b.r - a.r) * t + eps;
    out.push(cubeRound(q, r));
  }
  return out;
}

/** Index of the direction if b = a + k * direction for some k >= 1, else -1. */
export function straightDirection(a: Hex, b: Hex): number {
  const k = hexDistance(a, b);
  if (k === 0) return -1;
  return DIRECTIONS.findIndex((d) => hexEquals(hexAdd(a, hexScale(d, k)), b));
}
