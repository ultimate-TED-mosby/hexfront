// Play phase: select a piece, pick an action, click a highlighted hex. The server validates everything.
import { useEffect, useMemo, useState } from 'react';
import {
  RULES,
  armoredDamage,
  attackDamage,
  chargePath,
  hexDistance,
  hexEquals,
  hexKey,
  legalActionsForUnit,
  opponent,
  rangeOf,
  statsOf,
  unitAt,
  unitName,
} from '@hexfront/shared';
import type { AbilityId, Action, ActionType, GameState, Hex, RoomView, Unit } from '@hexfront/shared';
import { Board, type Highlight } from './Board';
import { EndOverlay } from './EndOverlay';
import { GameLog } from './GameLog';
import { ACTION_HELP, ACTION_LABEL, COLOR_NAME, INSTANT_ACTIONS } from '../labels';

interface GameProps {
  room: RoomView;
  onAction: (action: Action) => Promise<boolean>;
  onRematch: () => void;
  onLeave: () => void;
}

type TargetedType = Exclude<ActionType, 'entrench' | 'overwatch' | 'rally' | 'endTurn'>;

const HIGHLIGHT_OF: Record<TargetedType, Highlight> = {
  move: 'move',
  attack: 'target',
  charge: 'charge',
  fireball: 'target',
  trap: 'ability',
  heal: 'heal',
  aidStation: 'heal',
  banner: 'ability',
};

/** Hex that a targeted action points at (destination, target unit or target hex). */
function actionHex(game: GameState, a: Action): Hex | null {
  switch (a.type) {
    case 'move':
    case 'charge':
      return a.to;
    case 'attack':
    case 'heal':
      return game.units.find((u) => u.id === a.targetId)?.pos ?? null;
    case 'fireball':
    case 'trap':
    case 'aidStation':
    case 'banner':
      return a.target;
    default:
      return null;
  }
}

/** Number of own turns before an ability is ready again (0 = ready). */
function turnsUntilReady(game: GameState, unit: Unit, ability: AbilityId): number {
  const readyAt = unit.readyAt[ability] ?? 0;
  return readyAt <= game.turn ? 0 : Math.ceil((readyAt - game.turn) / 2);
}

const ABILITY_OF: Partial<Record<Unit['cls'], AbilityId[]>> = {
  mage: ['fireball'],
  knight: ['charge'],
  assassin: ['trap'],
  medic: ['aidStation'],
  viceGeneral: ['banner'],
};

export function Game({ room, onAction, onRematch, onLeave }: GameProps) {
  const { game, you } = room;
  const myTurn = game.phase === 'playing' && game.current === you;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<ActionType | null>(null);
  const [chargeTo, setChargeTo] = useState<Hex | null>(null);
  const [hover, setHover] = useState<Hex | null>(null);
  const [pending, setPending] = useState(false);

  const selected = game.units.find((u) => u.id === selectedId) ?? null;
  const legal = useMemo(
    () => (myTurn && selected && selected.owner === you ? legalActionsForUnit(game, you, selected.id) : []),
    [game, myTurn, selected, you],
  );
  const availableTypes = useMemo(() => [...new Set(legal.map((a) => a.type))], [legal]);

  // Keep the selection valid when the state changes (unit died, turn passed...).
  useEffect(() => {
    if (selectedId && !game.units.some((u) => u.id === selectedId)) setSelectedId(null);
  }, [game.units, selectedId]);
  useEffect(() => {
    if (mode && !availableTypes.includes(mode)) setMode(null);
    setChargeTo(null);
  }, [availableTypes, mode]);

  /** Legal actions of the current mode, indexed by the hex to click. */
  const targets = useMemo(() => {
    const map = new Map<string, Action[]>();
    if (!mode || INSTANT_ACTIONS.has(mode)) return map;
    for (const a of legal) {
      if (a.type !== mode) continue;
      if (a.type === 'charge' && chargeTo) {
        if (!hexEquals(a.to, chargeTo)) continue;
        const target = game.units.find((u) => u.id === a.targetId);
        if (target) map.set(hexKey(target.pos), [a]);
        continue;
      }
      const h = actionHex(game, a);
      if (h) map.set(hexKey(h), [...(map.get(hexKey(h)) ?? []), a]);
    }
    return map;
  }, [chargeTo, game, legal, mode]);

  const highlights = useMemo(() => {
    const map = new Map<string, Highlight>();
    if (!mode || INSTANT_ACTIONS.has(mode)) return map;
    const kind = chargeTo ? 'target' : HIGHLIGHT_OF[mode as TargetedType];
    for (const k of targets.keys()) map.set(k, kind);
    return map;
  }, [chargeTo, mode, targets]);

  const dimmed = useMemo(
    () => new Set(myTurn ? game.units.filter((u) => u.owner === you && u.actionsUsed >= RULES.maxActionsPerUnit).map((u) => u.id) : []),
    [game.units, myTurn, you],
  );

  const send = async (action: Action) => {
    setPending(true);
    const ok = await onAction(action);
    setPending(false);
    if (ok) {
      setChargeTo(null);
      if (action.type === 'endTurn') {
        setSelectedId(null);
        setMode(null);
      }
    }
  };

  /** Picks a unit and its most likely action. */
  const select = (unit: Unit | null) => {
    setSelectedId(unit?.id ?? null);
    setChargeTo(null);
    if (!unit || unit.owner !== you || !myTurn) return setMode(null);
    const types = new Set(legalActionsForUnit(game, you, unit.id).map((a) => a.type));
    setMode(types.has('move') ? 'move' : types.has('attack') ? 'attack' : null);
  };

  const onHexClick = (h: Hex) => {
    if (pending) return;
    const actions = targets.get(hexKey(h));
    if (actions && actions.length > 0) {
      const first = actions[0]!;
      if (first.type === 'charge' && !chargeTo) {
        if (actions.length === 1) void send(first);
        else setChargeTo(first.to);
        return;
      }
      void send(first);
      return;
    }
    setChargeTo(null);
    const unit = unitAt(game, h);
    select(unit && unit.id !== selectedId ? unit : null);
  };

  /** One-line damage/heal preview for the hovered target. */
  const preview = useMemo(() => {
    if (!hover || !selected || !mode) return null;
    const actions = targets.get(hexKey(hover));
    if (!actions?.length) return null;
    const a = actions[0]!;
    const target = unitAt(game, hover);
    if (a.type === 'attack' && target) {
      const dmg = attackDamage(game, selected, target);
      return `${unitName(target)} : −${dmg} PV → ${Math.max(0, target.hp - dmg)}/${target.maxHp}`;
    }
    if (a.type === 'charge' && target && chargeTo) {
      const path = chargePath(selected.pos, chargeTo) ?? [];
      const dmg = attackDamage(game, { ...selected, pos: chargeTo }, target, path.length >= 2);
      return `Charge sur ${unitName(target)} : −${dmg} PV → ${Math.max(0, target.hp - dmg)}/${target.maxHp}`;
    }
    if (a.type === 'charge') {
      const path = chargePath(selected.pos, a.to) ?? [];
      return path.length >= 2 ? 'Charge de 2+ cases : +1 dégât.' : 'Charge d’une case : pas de bonus.';
    }
    if (a.type === 'fireball') {
      const hit = game.units.filter((u) => hexDistance(u.pos, hover) <= 1);
      if (hit.length === 0) return 'Aucune pièce touchée.';
      return hit
        .map((u) => {
          const base = hexEquals(u.pos, hover) ? RULES.fireballCenterDamage : RULES.fireballSplashDamage;
          return `${unitName(u)} −${armoredDamage(game, u, base, true)}`;
        })
        .join(' · ');
    }
    if (a.type === 'heal' && target) {
      const amount = Math.min(RULES.healAmount, target.maxHp - target.hp, game.players[you].kit);
      return `${unitName(target)} : +${amount} PV`;
    }
    return null;
  }, [chargeTo, game, hover, mode, selected, targets, you]);

  const oppSeat = room.seats[opponent(you)];
  const abilityStatus =
    selected && ABILITY_OF[selected.cls]?.map((ab) => {
      const n = turnsUntilReady(game, selected, ab);
      return `${ACTION_LABEL[ab]} : ${n === 0 ? 'prête' : `dans ${n} tour(s)`}`;
    });

  return (
    <div className="layout">
      <div className="board-wrap">
        <Board
          you={you}
          units={game.units}
          effects={game.effects}
          highlights={highlights}
          selectedId={selectedId}
          dimmedIds={dimmed}
          onHexClick={onHexClick}
          onHexHover={setHover}
        />
        <div className="legend">
          <span><i className="sw hl-move" />Déplacement</span>
          <span><i className="sw hl-target" />Cible</span>
          <span><i className="sw hl-charge" />Charge</span>
          <span><i className="sw hl-ability" />Capacité</span>
          <span><i className="sw hl-heal" />Soin</span>
          <span><i className="sw fx-fire-sw" />Feu</span>
        </div>
      </div>

      <aside className="panel">
        <div className={`turn-banner ${myTurn ? 'mine' : ''}`}>
          <div>
            <strong>Tour {game.turn}</strong> · {myTurn ? 'À vous de jouer' : `Tour de ${COLOR_NAME[game.current]}`}
          </div>
          <div className="pips" aria-label={`${game.actionsLeft} action(s) restante(s)`}>
            {Array.from({ length: game.actionsLeft }, (_, i) => (
              <span key={i} className="pip" />
            ))}
            <span className="pip-label">{game.actionsLeft} action(s)</span>
          </div>
        </div>
        <p className="muted small">
          Vous êtes <strong className={`side-${you}`}>{COLOR_NAME[you]}</strong> · Trousse {game.players[you].kit} PV · Ralliement{' '}
          {game.players[you].rallyUsed ? 'utilisé' : 'disponible'}
          {!oppSeat.connected && <span className="warn"> · Adversaire déconnecté</span>}
        </p>

        {selected ? (
          <div className="unit-card">
            <h3 className={`side-${selected.owner}`}>{unitName(selected)}</h3>
            <dl>
              <dt>PV</dt>
              <dd>
                {selected.hp}/{selected.maxHp}
              </dd>
              <dt>Mouvement</dt>
              <dd>{statsOf(selected).move}</dd>
              <dt>Portée</dt>
              <dd>
                {rangeOf(selected).min === rangeOf(selected).max ? rangeOf(selected).max : `${rangeOf(selected).min}–${rangeOf(selected).max}`}
              </dd>
              <dt>Attaque</dt>
              <dd>{statsOf(selected).attack}</dd>
              <dt>Armure</dt>
              <dd>{statsOf(selected).armor}</dd>
              {selected.owner === game.current && (
                <>
                  <dt>Actions</dt>
                  <dd>
                    {selected.actionsUsed}/{RULES.maxActionsPerUnit}
                    {selected.attacked ? ' · a attaqué' : ''}
                  </dd>
                </>
              )}
            </dl>
            {(selected.entrenched || selected.overwatch) && (
              <p className="small">
                {selected.entrenched && 'Retranché (+1 armure). '}
                {selected.overwatch && 'Tir de couverture armé.'}
              </p>
            )}
            {abilityStatus && <p className="small muted">{abilityStatus.join(' · ')}</p>}

            {selected.owner === you && myTurn && (
              <div className="action-buttons">
                {availableTypes.length === 0 && <p className="muted small">Aucune action possible pour cette pièce.</p>}
                {availableTypes.map((t) =>
                  INSTANT_ACTIONS.has(t) ? (
                    <button key={t} disabled={pending} onClick={() => void send(legal.find((a) => a.type === t)!)}>
                      {ACTION_LABEL[t]}
                    </button>
                  ) : (
                    <button
                      key={t}
                      className={mode === t ? 'active' : ''}
                      onClick={() => {
                        setMode(t);
                        setChargeTo(null);
                      }}
                    >
                      {ACTION_LABEL[t]}
                    </button>
                  ),
                )}
              </div>
            )}
            {mode && myTurn && selected.owner === you && (
              <p className="small help">
                {chargeTo ? 'Choisissez la cible de la charge.' : ACTION_HELP[mode]}
              </p>
            )}
            {preview && <p className="preview">{preview}</p>}
          </div>
        ) : (
          <p className="muted small">
            {myTurn ? 'Sélectionnez une de vos pièces sur le plateau.' : 'Cliquez sur une pièce pour voir ses caractéristiques.'}
          </p>
        )}

        <button className="primary big" disabled={!myTurn || pending} onClick={() => void send({ type: 'endTurn' })}>
          Fin de tour
        </button>

        <GameLog log={game.log} />
      </aside>

      {game.phase === 'finished' && <EndOverlay room={room} onRematch={onRematch} onLeave={onLeave} />}
    </div>
  );
}
