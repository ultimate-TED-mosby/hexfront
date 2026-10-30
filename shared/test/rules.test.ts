import { describe, expect, it } from 'vitest';
import {
  HQ,
  applyDeployment,
  armorOf,
  armyRoster,
  attackDamage,
  createGame,
  hasLineOfSight,
  hexDistance,
  hexLabel,
  legalActionsForUnit,
  parseLabel,
  viewForPlayer,
} from '../src/index.js';
import type { Placement } from '../src/index.js';
import { act, at, rejects, setup, unit } from './helpers.js';

describe('board & hex geometry', () => {
  it('labels round-trip and QGs are 12 hexes apart', () => {
    expect(hexLabel(parseLabel('G7'))).toBe('G7');
    expect(hexLabel(HQ.blue)).toBe('M4');
    expect(hexDistance(HQ.blue, HQ.red)).toBe(12);
  });

  it('forest and ruin block line of sight, units do not', () => {
    expect(hasLineOfSight(at('J6'), at('G7'))).toBe(true);
    expect(hasLineOfSight(at('E7'), at('G7'))).toBe(false); // the ruin F7 sits between them
  });
});

describe('deployment', () => {
  const place = (player: 'blue' | 'red', rows: string[]): Placement[] => {
    const cells = rows.flatMap((row) => Array.from({ length: 9 }, (_, i) => `${row}${i + 1}`)).filter((l) => {
      try {
        parseLabel(l);
        return true;
      } catch {
        return false;
      }
    });
    return armyRoster(player).map((r, i) => ({ unitId: r.unitId, pos: parseLabel(cells[i]!) }));
  };

  it('is hidden until both are ready, then blue starts with 2 actions', () => {
    let s = createGame();
    const r1 = applyDeployment(s, 'blue', place('blue', ['K', 'L']));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    s = r1.state;
    expect(viewForPlayer(s, 'red').units).toHaveLength(0);
    const r2 = applyDeployment(s, 'red', place('red', ['C', 'B']));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.state.phase).toBe('playing');
    expect(r2.state.current).toBe('blue');
    expect(r2.state.actionsLeft).toBe(2);
    expect(viewForPlayer(r2.state, 'red').units).toHaveLength(26);
  });

  it('rejects pieces outside the deployment zone', () => {
    const res = applyDeployment(createGame(), 'blue', place('blue', ['G', 'H']));
    expect(res.ok).toBe(false);
  });
});

describe('movement', () => {
  it('moves up to MV on plains and spends one action', () => {
    let s = setup([{ id: 'b-sol', owner: 'blue', cls: 'soldier', at: 'I5' }]);
    s = act(s, 'blue', { type: 'move', unitId: 'b-sol', to: at('G5') });
    expect(hexLabel(unit(s, 'b-sol').pos)).toBe('G5');
    expect(s.actionsLeft).toBe(2);
    expect(unit(s, 'b-sol').actionsUsed).toBe(1);
  });

  it('cannot move further than MV nor act more than twice', () => {
    let s = setup([{ id: 'b-sol', owner: 'blue', cls: 'soldier', at: 'I5' }]);
    rejects(s, 'blue', { type: 'move', unitId: 'b-sol', to: at('F5') }); // distance 3
    s = act(s, 'blue', { type: 'move', unitId: 'b-sol', to: at('H5') });
    s = act(s, 'blue', { type: 'move', unitId: 'b-sol', to: at('G5') });
    rejects(s, 'blue', { type: 'move', unitId: 'b-sol', to: at('G4') });
  });

  it('stops when entering an enemy zone of control, except the assassin', () => {
    const s = setup([
      { id: 'b-sol', owner: 'blue', cls: 'soldier', at: 'I5' },
      { id: 'b-ass', owner: 'blue', cls: 'assassin', at: 'I4' },
      { id: 'r-sol', owner: 'red', cls: 'soldier', at: 'G6' },
    ]);
    // The only 2-step route I5 → H5 → G5 enters H5, adjacent to G6: the soldier must stop there.
    rejects(s, 'blue', { type: 'move', unitId: 'b-sol', to: at('G5') });
    const s2 = act(s, 'blue', { type: 'move', unitId: 'b-ass', to: at('G5') });
    expect(hexLabel(unit(s2, 'b-ass').pos)).toBe('G5');
  });

  it('forest costs 2 movement points', () => {
    const s = setup([{ id: 'b-sol', owner: 'blue', cls: 'soldier', at: 'I4' }]);
    // I3 is a forest: entering it uses the whole MV 2, so I2 (only reachable through I3) is out of reach.
    const moves = legalActionsForUnit(s, 'blue', 'b-sol').filter((a) => a.type === 'move');
    expect(moves.some((a) => a.type === 'move' && hexLabel(a.to) === 'I3')).toBe(true);
    rejects(s, 'blue', { type: 'move', unitId: 'b-sol', to: at('I2') });
  });
});

describe('attack & defense', () => {
  it('knight deals ATQ 3 to an unarmored soldier, 2 if it is in formation', () => {
    let s = setup([
      { id: 'b-kn', owner: 'blue', cls: 'knight', at: 'I5' },
      { id: 'r-sol', owner: 'red', cls: 'soldier', at: 'H5' },
    ]);
    s = act(s, 'blue', { type: 'attack', unitId: 'b-kn', targetId: 'r-sol' });
    expect(unit(s, 'r-sol').hp).toBe(1);

    const f = setup([
      { id: 'b-kn', owner: 'blue', cls: 'knight', at: 'I5' },
      { id: 'r-sol', owner: 'red', cls: 'soldier', at: 'H5' },
      { id: 'r-sol2', owner: 'red', cls: 'soldier', at: 'H4' },
    ]);
    expect(attackDamage(f, unit(f, 'b-kn'), unit(f, 'r-sol'))).toBe(2);
  });

  it('one attack per unit per turn, archers cannot shoot adjacent', () => {
    let s = setup([
      { id: 'b-kn', owner: 'blue', cls: 'knight', at: 'I5' },
      { id: 'b-arc', owner: 'blue', cls: 'archer', at: 'I4' },
      { id: 'r-gen', owner: 'red', cls: 'general', at: 'H5' },
    ]);
    s = act(s, 'blue', { type: 'attack', unitId: 'b-kn', targetId: 'r-gen' });
    rejects(s, 'blue', { type: 'attack', unitId: 'b-kn', targetId: 'r-gen' });
    rejects(s, 'blue', { type: 'attack', unitId: 'b-arc', targetId: 'r-gen' }); // adjacent: below min range 2
  });

  it('entrenching gives +1 armor, ends the unit turn, and armor is capped at 2', () => {
    let s = setup([
      { id: 'b-kn', owner: 'blue', cls: 'knight', at: 'H6' }, // ruin
      { id: 'b-gen', owner: 'blue', cls: 'general', at: 'H7' },
    ]);
    s = act(s, 'blue', { type: 'entrench', unitId: 'b-kn' });
    const kn = unit(s, 'b-kn');
    expect(kn.entrenched).toBe(true);
    rejects(s, 'blue', { type: 'move', unitId: 'b-kn', to: at('I6') });
    // base 1 + presence 1 + ruin 1 + entrench 1 = 4 → capped at 2
    expect(armorOf(s, kn, false)).toBe(2);
  });

  it('a hit always deals at least 1 damage', () => {
    const s = setup([
      { id: 'b-sol', owner: 'blue', cls: 'soldier', at: 'I5' },
      { id: 'r-kn', owner: 'red', cls: 'knight', at: 'H6' }, // ruin: armor 2
    ]);
    expect(attackDamage(s, unit(s, 'b-sol'), unit(s, 'r-kn'))).toBe(1);
  });
});

describe('medic', () => {
  it('heals +2 from the kit, once per target per turn, never above max HP', () => {
    let s = setup([
      { id: 'b-med', owner: 'blue', cls: 'medic', at: 'I5' },
      { id: 'b-kn', owner: 'blue', cls: 'knight', at: 'I6', hp: 3 },
    ]);
    s = act(s, 'blue', { type: 'heal', unitId: 'b-med', targetId: 'b-kn' });
    expect(unit(s, 'b-kn').hp).toBe(5);
    expect(s.players.blue.kit).toBe(8);
    rejects(s, 'blue', { type: 'heal', unitId: 'b-med', targetId: 'b-kn' });

    const full = setup([
      { id: 'b-med', owner: 'blue', cls: 'medic', at: 'I5' },
      { id: 'b-kn', owner: 'blue', cls: 'knight', at: 'I6', hp: 5 },
    ]);
    const healed = act(full, 'blue', { type: 'heal', unitId: 'b-med', targetId: 'b-kn' });
    expect(unit(healed, 'b-kn').hp).toBe(6);
    expect(healed.players.blue.kit).toBe(9);
  });

  it('cannot heal a unit standing on fire', () => {
    const s = setup([
      { id: 'b-med', owner: 'blue', cls: 'medic', at: 'I5' },
      { id: 'b-kn', owner: 'blue', cls: 'knight', at: 'I6', hp: 3 },
    ]);
    s.effects.push({ id: 99, kind: 'fire', owner: 'red', pos: at('I6'), expiresAt: 10 });
    rejects(s, 'blue', { type: 'heal', unitId: 'b-med', targetId: 'b-kn' });
  });
});

describe('mage', () => {
  it('fireball: 2 on the centre, 1 on adjacent hexes (friendly fire), leaves fire, cooldown 1', () => {
    let s = setup([
      { id: 'b-mag', owner: 'blue', cls: 'mage', at: 'I8' },
      { id: 'b-sol', owner: 'blue', cls: 'soldier', at: 'H8' },
      { id: 'r-sol', owner: 'red', cls: 'soldier', at: 'H7' },
      { id: 'r-arc', owner: 'red', cls: 'archer', at: 'G8' },
    ]);
    s = act(s, 'blue', { type: 'fireball', unitId: 'b-mag', target: at('H7') });
    expect(unit(s, 'r-sol').hp).toBe(2);
    expect(unit(s, 'r-arc').hp).toBe(2);
    expect(unit(s, 'b-sol').hp).toBe(3);
    expect(s.effects.some((e) => e.kind === 'fire' && hexLabel(e.pos) === 'H7')).toBe(true);

    // Next blue turn (turn 5): still on cooldown. Turn 7: ready again.
    s = act(s, 'blue', { type: 'endTurn' });
    s = act(s, 'red', { type: 'endTurn' });
    expect(s.turn).toBe(5);
    rejects(s, 'blue', { type: 'fireball', unitId: 'b-mag', target: at('H7') });
    s = act(s, 'blue', { type: 'endTurn' });
    s = act(s, 'red', { type: 'endTurn' });
    expect(s.turn).toBe(7);
    expect(s.effects.some((e) => e.kind === 'fire')).toBe(false); // duration 2 expired
    act(s, 'blue', { type: 'fireball', unitId: 'b-mag', target: at('G8') });
  });

  it('fire burns enemies at the start of their turn', () => {
    let s = setup([
      { id: 'b-mag', owner: 'blue', cls: 'mage', at: 'I8' },
      { id: 'r-kn', owner: 'red', cls: 'knight', at: 'H7' },
    ]);
    s = act(s, 'blue', { type: 'fireball', unitId: 'b-mag', target: at('H7') });
    expect(unit(s, 'r-kn').hp).toBe(5); // 2 - armor 1
    s = act(s, 'blue', { type: 'endTurn' });
    expect(unit(s, 'r-kn').hp).toBe(4); // fire ignores armor
  });

  it('arcane bolt deals 1 ignoring armor', () => {
    let s = setup([
      { id: 'b-mag', owner: 'blue', cls: 'mage', at: 'I8' },
      { id: 'r-kn', owner: 'red', cls: 'knight', at: 'G8', hp: 6 },
    ]);
    s = act(s, 'blue', { type: 'attack', unitId: 'b-mag', targetId: 'r-kn' });
    expect(unit(s, 'r-kn').hp).toBe(5);
  });
});

describe('knight charge', () => {
  it('charges 2 hexes in a straight line and hits with +1', () => {
    let s = setup([
      { id: 'b-kn', owner: 'blue', cls: 'knight', at: 'I7' },
      { id: 'r-sol', owner: 'red', cls: 'soldier', at: 'I4' },
    ]);
    s = act(s, 'blue', { type: 'charge', unitId: 'b-kn', to: at('I5'), targetId: 'r-sol' });
    expect(hexLabel(unit(s, 'b-kn').pos)).toBe('I5');
    expect(s.units.some((u) => u.id === 'r-sol')).toBe(false); // 3 + 1 charge = 4 damage → dead
    expect(s.actionsLeft).toBe(2);
  });

  it('a 1-hex charge has no bonus; non-straight or forest paths are rejected; cooldown 1', () => {
    let s = setup([
      { id: 'b-kn', owner: 'blue', cls: 'knight', at: 'I6' },
      { id: 'r-gen', owner: 'red', cls: 'general', at: 'I4' },
    ]);
    rejects(s, 'blue', { type: 'charge', unitId: 'b-kn', to: at('H4'), targetId: 'r-gen' }); // not straight
    s = act(s, 'blue', { type: 'charge', unitId: 'b-kn', to: at('I5'), targetId: 'r-gen' });
    expect(unit(s, 'r-gen').hp).toBe(5); // 3 - 1 armor, no bonus
    const forest = setup([
      { id: 'b-kn', owner: 'blue', cls: 'knight', at: 'I5' },
      { id: 'r-sol', owner: 'red', cls: 'soldier', at: 'H2' },
    ]);
    rejects(forest, 'blue', { type: 'charge', unitId: 'b-kn', to: at('I3'), targetId: 'r-sol' }); // I3 forest
  });
});

describe('vice-general banner', () => {
  it('gives +1 ATQ to allies on/adjacent to the banner, not to the mage bolt, and expires', () => {
    let s = setup([
      { id: 'b-vg', owner: 'blue', cls: 'viceGeneral', at: 'I5' },
      { id: 'b-sol', owner: 'blue', cls: 'soldier', at: 'I6' },
      { id: 'b-mag', owner: 'blue', cls: 'mage', at: 'I7' },
      { id: 'r-sol', owner: 'red', cls: 'soldier', at: 'H7' },
    ]);
    const before = attackDamage(s, unit(s, 'b-sol'), unit(s, 'r-sol'));
    s = act(s, 'blue', { type: 'banner', unitId: 'b-vg', target: at('I6') });
    expect(attackDamage(s, unit(s, 'b-sol'), unit(s, 'r-sol'))).toBe(before + 1);
    expect(attackDamage(s, unit(s, 'b-mag'), unit(s, 'r-sol'))).toBe(1);
    s = act(s, 'blue', { type: 'endTurn' });
    expect(s.effects.some((e) => e.kind === 'banner')).toBe(true); // still active during red's turn
    s = act(s, 'red', { type: 'endTurn' });
    expect(s.effects.some((e) => e.kind === 'banner')).toBe(false); // removed at start of blue's next turn
  });
});

describe('general death', () => {
  it('the vice-general succeeds: promoted, and the side gets 2 actions next turn', () => {
    let s = setup([
      { id: 'b-kn', owner: 'blue', cls: 'knight', at: 'I5' },
      { id: 'r-gen', owner: 'red', cls: 'general', at: 'H5', hp: 2 },
      { id: 'r-vg', owner: 'red', cls: 'viceGeneral', at: 'B4' },
    ]);
    s = act(s, 'blue', { type: 'attack', unitId: 'b-kn', targetId: 'r-gen' });
    expect(s.units.some((u) => u.id === 'r-gen')).toBe(false);
    expect(s.phase).toBe('playing');
    expect(unit(s, 'r-vg').cls).toBe('general');
    expect(unit(s, 'r-vg').promoted).toBe(true);
    s = act(s, 'blue', { type: 'endTurn' });
    expect(s.actionsLeft).toBe(2);
  });

  it('without a vice-general it is a decapitation victory', () => {
    let s = setup([
      { id: 'b-kn', owner: 'blue', cls: 'knight', at: 'I5' },
      { id: 'r-gen', owner: 'red', cls: 'general', at: 'H5', hp: 2 },
    ]);
    s = act(s, 'blue', { type: 'attack', unitId: 'b-kn', targetId: 'r-gen' });
    expect(s.phase).toBe('finished');
    expect(s.winner).toBe('blue');
    expect(s.endReason).toBe('decapitation');
  });

  it('the general cannot lose more than 4 HP during one enemy turn', () => {
    let s = setup([
      { id: 'b-kn', owner: 'blue', cls: 'knight', at: 'I5' },
      { id: 'b-kn2', owner: 'blue', cls: 'knight', at: 'H4' },
      { id: 'b-gen', owner: 'blue', cls: 'general', at: 'G6' },
      { id: 'r-gen', owner: 'red', cls: 'general', at: 'H5' },
    ]);
    s = act(s, 'blue', { type: 'attack', unitId: 'b-kn', targetId: 'r-gen' }); // 2
    s = act(s, 'blue', { type: 'attack', unitId: 'b-kn2', targetId: 'r-gen' }); // 2
    s = act(s, 'blue', { type: 'attack', unitId: 'b-gen', targetId: 'r-gen' }); // capped → 0
    expect(unit(s, 'r-gen').hp).toBe(3);
  });
});

describe('QG capture', () => {
  it('a unit that survives a full enemy turn on the enemy QG wins', () => {
    let s = setup([
      { id: 'b-kn', owner: 'blue', cls: 'knight', at: 'B4' },
      { id: 'r-gen', owner: 'red', cls: 'general', at: 'G10' },
    ]);
    s = act(s, 'blue', { type: 'move', unitId: 'b-kn', to: at('A4') });
    s = act(s, 'blue', { type: 'endTurn' });
    expect(unit(s, 'b-kn').hp).toBe(4); // QG salvo: 2, ignores armor
    expect(s.phase).toBe('playing');
    s = act(s, 'red', { type: 'endTurn' });
    expect(s.phase).toBe('finished');
    expect(s.winner).toBe('blue');
    expect(s.endReason).toBe('capture');
  });

  it('the assassin cannot capture', () => {
    let s = setup([
      { id: 'b-ass', owner: 'blue', cls: 'assassin', at: 'B4' },
      { id: 'r-gen', owner: 'red', cls: 'general', at: 'G10' },
    ]);
    s = act(s, 'blue', { type: 'move', unitId: 'b-ass', to: at('A4') });
    s = act(s, 'blue', { type: 'endTurn' });
    s = act(s, 'red', { type: 'endTurn' });
    expect(s.phase).toBe('playing');
  });

  it('a unit left on its own QG at end of turn takes 2 damage (garrison rule)', () => {
    let s = setup([{ id: 'b-sol', owner: 'blue', cls: 'soldier', at: 'M4' }]);
    s = act(s, 'blue', { type: 'endTurn' });
    expect(unit(s, 'b-sol').hp).toBe(2);
  });
});

describe('stall rules', () => {
  it('a quiet opening never ends the game; after first blood, 10 quiet turns go to the points count', () => {
    let s = setup([
      { id: 'b-kn', owner: 'blue', cls: 'knight', at: 'I5' },
      { id: 'r-sol', owner: 'red', cls: 'soldier', at: 'C4' },
    ]);
    for (let i = 0; i < 12; i++) s = act(s, s.current, { type: 'endTurn' });
    expect(s.phase).toBe('playing');
    s.current = 'blue';
    s.actionsLeft = 3;
    s.damageThisTurn = true; // simulate a first hit this turn
    s = act(s, 'blue', { type: 'endTurn' });
    expect(s.bloodied).toBe(true);
    for (let i = 0; i < 10 && s.phase === 'playing'; i++) s = act(s, s.current, { type: 'endTurn' });
    expect(s.phase).toBe('finished');
    expect(s.winner).toBe('blue'); // knight (3) vs soldier (1)
    expect(s.endReason).toBe('points');
  });
});

describe('reactions', () => {
  it('overwatch hits the first enemy entering its range, once', () => {
    let s = setup([
      { id: 'b-kn', owner: 'blue', cls: 'knight', at: 'J7' },
      { id: 'r-arc', owner: 'red', cls: 'archer', at: 'E8' },
    ]);
    unit(s, 'r-arc').overwatch = true;
    s = act(s, 'blue', { type: 'move', unitId: 'b-kn', to: at('H7') });
    expect(unit(s, 'b-kn').hp).toBe(5); // 2 - armor 1
    expect(unit(s, 'r-arc').overwatch).toBe(false);
  });

  it('a trap stops the enemy and deals 2', () => {
    let s = setup([{ id: 'b-sol', owner: 'blue', cls: 'soldier', at: 'I5' }]);
    s.effects.push({ id: 1, kind: 'trap', owner: 'red', pos: at('H5'), expiresAt: null });
    rejects(s, 'blue', { type: 'move', unitId: 'b-sol', to: at('G5') }); // must stop on the trap
    s = act(s, 'blue', { type: 'move', unitId: 'b-sol', to: at('H5') });
    expect(unit(s, 'b-sol').hp).toBe(2);
    expect(s.effects).toHaveLength(0);
  });
});
