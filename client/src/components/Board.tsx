// SVG hex board. Pure display: every click is reported to the parent, which decides what it means.
import { memo } from 'react';
import { HQ, allHexes, hexKey, hexLabel, isRampartOf, terrainAt, unitName } from '@hexfront/shared';
import type { Effect, Hex, PlayerId, Terrain, Unit, UnitClass } from '@hexfront/shared';

export type Highlight = 'move' | 'target' | 'ability' | 'charge' | 'zone' | 'heal';

export interface BoardProps {
  /** Viewing player: the board is rotated so their QG is at the bottom. */
  you: PlayerId;
  units: Unit[];
  effects: Effect[];
  highlights?: ReadonlyMap<string, Highlight>;
  selectedId?: string | null;
  /** Units drawn faded (already used their 2 actions). */
  dimmedIds?: ReadonlySet<string>;
  onHexClick?: (h: Hex) => void;
  onHexHover?: (h: Hex | null) => void;
}

const SIZE = 30;
const SQRT3 = Math.sqrt(3);

export const UNIT_SHORT: Record<UnitClass, string> = {
  general: 'G',
  viceGeneral: 'VG',
  knight: 'C',
  soldier: 'S',
  archer: 'A',
  mage: 'M',
  assassin: 'As',
  medic: 'I',
};

const TERRAIN_NAMES: Record<Terrain, string> = {
  plain: 'Plaine',
  forest: 'Forêt',
  hill: 'Colline',
  water: 'Eau',
  ruin: 'Ruine',
};

/** Pixel centre of a hex, rotated 180° for the red player. */
function toPixel(h: Hex, you: PlayerId): { x: number; y: number } {
  const q = you === 'red' ? -h.q : h.q;
  const r = you === 'red' ? -h.r : h.r;
  return { x: SIZE * SQRT3 * (q + r / 2), y: SIZE * 1.5 * r };
}

/** Polygon points of a pointy-top hex of radius `size` around (x, y). */
function hexPoints(x: number, y: number, size = SIZE): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30);
    return `${(x + size * Math.cos(a)).toFixed(1)},${(y + size * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
}

/** Small terrain pictogram drawn under units. */
function TerrainGlyph({ terrain, x, y }: { terrain: Terrain; x: number; y: number }) {
  switch (terrain) {
    case 'forest':
      return (
        <g className="glyph">
          <path d={`M${x - 12},${y + 14} l6,-11 l6,11 z M${x + 2},${y + 15} l6,-11 l6,11 z`} />
        </g>
      );
    case 'hill':
      return <path className="glyph-line" d={`M${x - 15},${y + 15} q15,-14 30,0`} />;
    case 'water':
      return (
        <path
          className="glyph-line"
          d={`M${x - 14},${y + 11} q3.5,-4 7,0 t7,0 t7,0 t7,0 M${x - 14},${y + 17} q3.5,-4 7,0 t7,0 t7,0 t7,0`}
        />
      );
    case 'ruin':
      return (
        <g className="glyph">
          <rect x={x - 13} y={y + 8} width={6} height={9} />
          <rect x={x - 4} y={y + 12} width={6} height={5} />
          <rect x={x + 5} y={y + 6} width={6} height={11} />
        </g>
      );
    default:
      return null;
  }
}

/** Effect tokens (fire, trap, aid station, banner) on a hex. */
function EffectGlyph({ effect, x, y }: { effect: Effect; x: number; y: number }) {
  const side = effect.owner === 'blue' ? 'blue' : 'red';
  switch (effect.kind) {
    case 'fire':
      return <polygon className="fx-fire" points={hexPoints(x, y, SIZE - 3)} />;
    case 'trap':
      return (
        <g className={`fx-trap ${side}`}>
          <circle cx={x + 15} cy={y - 13} r={7} />
          <path d={`M${x + 11},${y - 17} l8,8 M${x + 19},${y - 17} l-8,8`} />
        </g>
      );
    case 'aidStation':
      return (
        <g className="fx-aid">
          <rect x={x - 22} y={y - 19} width={13} height={13} rx={2} />
          <path d={`M${x - 15.5},${y - 17} v9 M${x - 20},${y - 12.5} h9`} />
        </g>
      );
    case 'banner':
      return (
        <g className={`fx-banner ${side}`}>
          <path className="pole" d={`M${x + 12},${y + 18} v-24`} />
          <path className="flag" d={`M${x + 12},${y - 6} l13,4 l-13,4 z`} />
        </g>
      );
  }
}

/** One unit token with its HP. */
function UnitToken({ unit, x, y, selected, dimmed }: { unit: Unit; x: number; y: number; selected: boolean; dimmed: boolean }) {
  const hpRatio = unit.hp / unit.maxHp;
  return (
    <g className={`unit ${unit.owner}${dimmed ? ' dimmed' : ''}${selected ? ' selected' : ''}`}>
      {selected && <circle className="unit-ring" cx={x} cy={y} r={SIZE * 0.72} />}
      <circle className="unit-body" cx={x} cy={y - 2} r={SIZE * 0.55} />
      <text className="unit-label" x={x} y={y + 3}>
        {UNIT_SHORT[unit.cls]}
      </text>
      <rect className="hp-bg" x={x - 14} y={y + 15} width={28} height={5} rx={2} />
      <rect className={`hp-fg${hpRatio <= 0.34 ? ' low' : ''}`} x={x - 14} y={y + 15} width={28 * hpRatio} height={5} rx={2} />
      {unit.entrenched && <path className="badge-shield" d={`M${x - 20},${y - 18} h8 v5 q0,6 -4,8 q-4,-2 -4,-8 z`} />}
      {unit.overwatch && <circle className="badge-eye" cx={x + 16} cy={y - 16} r={4.5} />}
    </g>
  );
}

/** Rotation-aware hexagonal board. */
function BoardImpl({ you, units, effects, highlights, selectedId, dimmedIds, onHexClick, onHexHover }: BoardProps) {
  const hexes = allHexes();
  const unitByHex = new Map(units.map((u) => [hexKey(u.pos), u]));
  const effectsByHex = new Map<string, Effect[]>();
  for (const e of effects) effectsByHex.set(hexKey(e.pos), [...(effectsByHex.get(hexKey(e.pos)) ?? []), e]);

  const w = SIZE * SQRT3 * 6.5 + 4;
  const h = SIZE * 1.5 * 6 + SIZE + 4;

  return (
    <svg className="board" viewBox={`${-w} ${-h} ${2 * w} ${2 * h}`} role="img" aria-label="Plateau de jeu">
      {hexes.map((hx) => {
        const k = hexKey(hx);
        const { x, y } = toPixel(hx, you);
        const terrain = terrainAt(hx);
        const hl = highlights?.get(k);
        const unit = unitByHex.get(k);
        const isHq = hx.q === HQ.blue.q && hx.r === HQ.blue.r ? 'blue' : hx.q === HQ.red.q && hx.r === HQ.red.r ? 'red' : null;
        const rampart = isRampartOf(hx, 'blue') ? 'blue' : isRampartOf(hx, 'red') ? 'red' : null;
        const title = `${hexLabel(hx)} — ${isHq ? `QG ${isHq === 'blue' ? 'bleu' : 'rouge'}` : TERRAIN_NAMES[terrain]}${
          unit ? ` · ${unitName(unit)} ${unit.hp}/${unit.maxHp} PV` : ''
        }`;
        return (
          <g
            key={k}
            className={`cell${onHexClick ? ' clickable' : ''}`}
            onClick={() => onHexClick?.(hx)}
            onMouseEnter={() => onHexHover?.(hx)}
            onMouseLeave={() => onHexHover?.(null)}
          >
            <title>{title}</title>
            <polygon
              className={`hex t-${terrain}${isHq ? ` hq-${isHq}` : ''}${rampart ? ` rampart-${rampart}` : ''}`}
              points={hexPoints(x, y)}
            />
            <TerrainGlyph terrain={terrain} x={x} y={y} />
            {isHq && (
              <text className="hq-label" x={x} y={y + 18}>
                QG
              </text>
            )}
            <text className="coord" x={x} y={y - 17}>
              {hexLabel(hx)}
            </text>
            {(effectsByHex.get(k) ?? []).map((e) => (
              <EffectGlyph key={e.id} effect={e} x={x} y={y} />
            ))}
            {hl && <polygon className={`hl hl-${hl}`} points={hexPoints(x, y, SIZE - 2)} />}
            {unit && <UnitToken unit={unit} x={x} y={y} selected={unit.id === selectedId} dimmed={dimmedIds?.has(unit.id) ?? false} />}
          </g>
        );
      })}
    </svg>
  );
}

export const Board = memo(BoardImpl);
