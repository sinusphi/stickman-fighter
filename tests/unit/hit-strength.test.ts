import { describe, expect, it } from 'vitest';
import rules from '../../src/data/rules.json';
import { MOVES } from '../../src/data/schema';
import { hitStrength, knocksDown } from '../../src/simulation/combat';
import { createGame, step } from '../../src/simulation/state';
import { buttonBit, neutralInput } from '../../src/input/types';

const id = 'middle_high_punch_combo';
const chord = (facing: number) => ({ ...neutralInput(), right: facing === 1, left: facing === -1, buttons: buttonBit('HK') | buttonBit('RHK') });
function setup(facing: 1 | -1, distance = 40) {
  const game = createGame(), [a, b] = game.fighters;
  a.x = 480 * 256; b.x = a.x + facing * distance * 256;
  a.facing = a.attackFacing = facing; b.facing = b.attackFacing = facing === 1 ? -1 : 1;
  return game;
}

describe('hit strength and ground knockdowns', () => {
  it('lets only the finishers of the five-hit and the Revenge combo and both Wirbel hits knock down at the default stability', () => {
    const fighter = createGame().fighters[1];
    const heavy = Object.values(MOVES).flatMap(move => move.hitGroups.filter(group => knocksDown(move, group, fighter)).map(group => `${move.id}:${group.id}`));
    expect(heavy.sort()).toEqual([`${id}:punch`, 'revenge_combo:punch', 'special_spin:back', 'special_spin:front'].sort());
    expect(hitStrength(MOVES.standing_lp, MOVES.standing_lp.hitGroups[0])).toBe(MOVES.standing_lp.damage);
  });

  it('lower stability makes heavy hits knock down, light hits never', () => {
    const fighter = { ...createGame().fighters[1], stability: 100 };
    expect(knocksDown(MOVES.spin_hk, MOVES.spin_hk.hitGroups[0], fighter)).toBe(true);
    expect(knocksDown(MOVES.standing_lp, MOVES.standing_lp.hitGroups[0], fighter)).toBe(false);
  });

  it('the finisher of the five-hit combo throws the opponent down, who stands up again', () => {
    for (const facing of [1, -1] as const) {
      const game = setup(facing), defender = game.fighters[1];
      step(game, [chord(facing), neutralInput()]);
      const states: string[] = [];
      let groups = 0;
      for (let f = 0; f < 260; f++) {
        step(game, [neutralInput(), neutralInput()]);
        states.push(defender.state);
        if (game.fighters[0].hitTargets.length !== groups) {
          groups = game.fighters[0].hitTargets.length;
          // Strikes one to four only make the opponent flinch.
          if (groups < 5 && game.hitstop > 0) expect(defender.state).toBe('Hitstun');
        }
      }
      expect(groups).toBe(5);
      const down = states.indexOf('Knockdown');
      expect(down).toBeGreaterThan(0);
      expect(states.slice(down).some(state => state === 'Idle')).toBe(true);
      // Knocked back away from the attacker.
      expect((defender.x - game.fighters[0].x) * facing).toBeGreaterThan(0);
      expect(defender.y).toBe(0);
    }
  });

  it('keeps knockdown parameters sane', () => {
    expect(rules.hitStrength.groundKnockdownVelocity).toBeLessThan(0);
    expect(rules.hitStrength.defaultStability).toBeGreaterThan(Math.max(...Object.values(MOVES).filter(m => !m.throw).flatMap(m => m.hitGroups.map(g => g.damage ?? m.damage))));
  });
});
