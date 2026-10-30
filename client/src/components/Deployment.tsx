// Secret deployment: the player places 13 pieces in their zone, then clicks "Prêt".
import { useEffect, useMemo, useState } from 'react';
import {
  HQ,
  UNIT_NAMES,
  allHexes,
  armyRoster,
  createUnit,
  hexDistance,
  hexEquals,
  hexKey,
  hexLabel,
  isInDeploymentZone,
  opponent,
} from '@hexfront/shared';
import type { Hex, Placement, RoomView, UnitClass } from '@hexfront/shared';
import { Board, UNIT_SHORT, type Highlight } from './Board';
import { COLOR_NAME } from '../labels';

interface DeploymentProps {
  room: RoomView;
  onReady: (placements: Placement[]) => Promise<boolean>;
}

/** Front-to-back order used by "Placement rapide". */
const QUICK_ORDER: UnitClass[] = ['soldier', 'knight', 'assassin', 'archer', 'mage', 'viceGeneral', 'medic', 'general'];

/** sessionStorage key of the deployment draft, so a reload keeps the placements. */
function draftKey(room: RoomView): string {
  return `hexfront:draft:${room.code}:${room.you}`;
}

/** Restores a saved draft, ignoring corrupted or blocked storage. */
function loadDraft(room: RoomView): Record<string, Hex> {
  try {
    const raw = sessionStorage.getItem(draftKey(room));
    return raw ? (JSON.parse(raw) as Record<string, Hex>) : {};
  } catch {
    return {};
  }
}

export function Deployment({ room, onReady }: DeploymentProps) {
  const you = room.you;
  const roster = useMemo(() => armyRoster(you), [you]);
  const zone = useMemo(() => allHexes().filter((h) => isInDeploymentZone(h, you)), [you]);
  const [placed, setPlaced] = useState<Record<string, Hex>>(() => loadDraft(room));
  const [selected, setSelected] = useState<string | null>(roster[0]?.unitId ?? null);
  const [sending, setSending] = useState(false);
  const ready = room.game.players[you].deployed;
  const opponentReady = room.game.players[opponent(you)].deployed;

  useEffect(() => {
    try {
      sessionStorage.setItem(draftKey(room), JSON.stringify(placed));
    } catch {
      // Storage blocked: the draft is just not kept across reloads.
    }
  }, [placed, room]);

  const unplaced = roster.filter((r) => !placed[r.unitId]);
  const unitAtHex = (h: Hex) => Object.entries(placed).find(([, p]) => hexEquals(p, h))?.[0];

  /** Places the selected unit; an occupant is swapped back to the selected unit's old spot (or unplaced). */
  const clickHex = (h: Hex) => {
    if (ready || !isInDeploymentZone(h, you)) return;
    const occupant = unitAtHex(h);
    if (!selected) {
      if (occupant) setSelected(occupant);
      return;
    }
    if (occupant === selected) {
      setSelected(null);
      return;
    }
    const next = { ...placed };
    const from = next[selected];
    next[selected] = h;
    if (occupant) {
      if (from) next[occupant] = from;
      else delete next[occupant];
    }
    setPlaced(next);
    const nextUnplaced = roster.find((r) => !next[r.unitId]);
    setSelected(occupant && !from ? occupant : (nextUnplaced?.unitId ?? null));
  };

  /** Fills the remaining pieces front-to-back, leaving the QG empty. */
  const quickPlace = () => {
    const next = { ...placed };
    const free = zone
      .filter((h) => !hexEquals(h, HQ[you]) && !Object.values(next).some((p) => hexEquals(p, h)))
      .sort((a, b) => hexDistance(b, HQ[you]) - hexDistance(a, HQ[you]) || Math.abs(a.q + a.r / 2) - Math.abs(b.q + b.r / 2));
    const backFirst = [...free].reverse();
    for (const cls of QUICK_ORDER) {
      for (const r of roster.filter((x) => x.cls === cls && !next[x.unitId])) {
        const pool = cls === 'general' || cls === 'medic' || cls === 'viceGeneral' ? backFirst : free;
        const spot = pool.find((h) => !Object.values(next).some((p) => hexEquals(p, h)));
        if (spot) next[r.unitId] = spot;
      }
    }
    setPlaced(next);
    setSelected(null);
  };

  const submit = async () => {
    setSending(true);
    const ok = await onReady(roster.map((r) => ({ unitId: r.unitId, pos: placed[r.unitId]! })));
    setSending(false);
    if (ok) {
      try {
        sessionStorage.removeItem(draftKey(room));
      } catch {
        // ignore
      }
    }
  };

  const units = ready
    ? room.game.units
    : roster.filter((r) => placed[r.unitId]).map((r) => createUnit(r.unitId, you, r.cls, placed[r.unitId]!));
  const highlights = new Map<string, Highlight>(ready ? [] : zone.filter((h) => !unitAtHex(h)).map((h) => [hexKey(h), 'zone' as const]));
  const selectedPos = selected ? placed[selected] : undefined;

  return (
    <div className="layout">
      <div className="board-wrap">
        <Board you={you} units={units} effects={[]} highlights={highlights} selectedId={selected} onHexClick={clickHex} />
      </div>
      <aside className="panel">
        <h2>Déploiement secret</h2>
        <p className="muted">
          Vous êtes <strong className={`side-${you}`}>{COLOR_NAME[you]}</strong>
          {you === 'blue' ? ' et vous jouez en premier (2 actions au premier tour).' : '. Bleu joue en premier.'} Votre QG est en{' '}
          {hexLabel(HQ[you])}, en bas du plateau. L’adversaire ne voit rien avant que vous soyez tous les deux prêts.
        </p>

        {ready ? (
          <p className="status-line">
            <span className="pulse" aria-hidden="true" /> Vous êtes prêt. En attente du déploiement adverse…
          </p>
        ) : (
          <>
            <p className="muted small">
              Choisissez une pièce, puis une case claire de votre zone. Cliquez sur une pièce posée pour la déplacer.
            </p>
            <ul className="roster">
              {roster.map((r) => (
                <li key={r.unitId}>
                  <button
                    className={`roster-item${selected === r.unitId ? ' active' : ''}${placed[r.unitId] ? ' done' : ''}`}
                    onClick={() => setSelected(selected === r.unitId ? null : r.unitId)}
                  >
                    <span className={`chip ${you}`}>{UNIT_SHORT[r.cls]}</span>
                    {UNIT_NAMES[r.cls]}
                    <span className="where">{placed[r.unitId] ? hexLabel(placed[r.unitId]!) : '—'}</span>
                  </button>
                </li>
              ))}
            </ul>
            {selected && selectedPos && (
              <button
                className="ghost small"
                onClick={() => {
                  const next = { ...placed };
                  delete next[selected];
                  setPlaced(next);
                }}
              >
                Retirer {UNIT_NAMES[roster.find((r) => r.unitId === selected)!.cls]} du plateau
              </button>
            )}
            <div className="row wrap">
              <button onClick={quickPlace} disabled={unplaced.length === 0}>
                Placement rapide
              </button>
              <button className="ghost" onClick={() => setPlaced({})} disabled={Object.keys(placed).length === 0}>
                Tout retirer
              </button>
            </div>
            <button className="primary big" disabled={unplaced.length > 0 || sending} onClick={submit}>
              {unplaced.length > 0 ? `Prêt (${unplaced.length} pièce(s) à placer)` : 'Prêt !'}
            </button>
            <p className="muted small">Une pièce laissée sur votre propre QG en fin de tour subit 2 dégâts.</p>
          </>
        )}
        <p className="muted small">Adversaire : {opponentReady ? 'prêt ✓' : 'se déploie…'}</p>
      </aside>
    </div>
  );
}
