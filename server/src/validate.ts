// Runtime shape checks for untrusted socket payloads. Game legality is checked later by the shared rules.
import type { Action, Hex, Placement } from '@hexfront/shared';

const MAX_ID_LENGTH = 64;

/** Narrows unknown to a plain object. */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Short non-empty string (unit ids, codes, tokens). */
function isShortString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LENGTH;
}

/** Copies a {q, r} hex with small integer coordinates, or returns null. */
export function parseHex(v: unknown): Hex | null {
  if (!isObject(v)) return null;
  const { q, r } = v;
  if (!Number.isInteger(q) || !Number.isInteger(r)) return null;
  if (Math.abs(q as number) > 20 || Math.abs(r as number) > 20) return null;
  return { q: q as number, r: r as number };
}

/** Parses a non-empty string field, or returns null. */
export function parseString(v: unknown): string | null {
  return isShortString(v) ? v : null;
}

/** Parses a deployment payload (array of { unitId, pos }), or returns null. */
export function parsePlacements(v: unknown): Placement[] | null {
  if (!isObject(v) || !Array.isArray(v.placements) || v.placements.length > 32) return null;
  const out: Placement[] = [];
  for (const p of v.placements) {
    if (!isObject(p) || !isShortString(p.unitId)) return null;
    const pos = parseHex(p.pos);
    if (!pos) return null;
    out.push({ unitId: p.unitId, pos });
  }
  return out;
}

/** Rebuilds a well-formed Action from an untrusted payload { action }, or returns null. */
export function parseAction(v: unknown): Action | null {
  if (!isObject(v) || !isObject(v.action)) return null;
  const a = v.action;
  if (a.type === 'endTurn') return { type: 'endTurn' };
  if (!isShortString(a.unitId)) return null;
  const unitId = a.unitId;
  switch (a.type) {
    case 'entrench':
    case 'overwatch':
    case 'rally':
      return { type: a.type, unitId };
    case 'move': {
      const to = parseHex(a.to);
      return to ? { type: 'move', unitId, to } : null;
    }
    case 'attack':
    case 'heal':
      return isShortString(a.targetId) ? { type: a.type, unitId, targetId: a.targetId } : null;
    case 'fireball':
    case 'trap':
    case 'aidStation':
    case 'banner': {
      const target = parseHex(a.target);
      return target ? { type: a.type, unitId, target } : null;
    }
    case 'charge': {
      const to = parseHex(a.to);
      return to && isShortString(a.targetId) ? { type: 'charge', unitId, to, targetId: a.targetId } : null;
    }
    default:
      return null;
  }
}
