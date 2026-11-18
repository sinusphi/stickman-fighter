import { expect, it } from 'vitest';
import { MOVES } from '../../src/data/schema';
import { createGame, step } from '../../src/simulation/state';
import { buttonBit, neutralInput } from '../../src/input/types';
import { samplePose, sampleTurn } from '../../src/render/skeleton';
import { classifyHit, swingCues } from '../../src/platform/hit-sound';
const id = 'middle_high_punch_combo', h = buttonBit('HK'), n = buttonBit('RHK');
const input = (facing: number, buttons = h | n) => ({ ...neutralInput(), right: facing === 1, left: facing === -1, buttons });
function setup(facing: 1 | -1, distance = 40) {
  const game = createGame(), [a, b] = game.fighters;
  a.x = 480 * 256; b.x = a.x + facing * distance * 256;
  a.facing = a.attackFacing = facing; b.facing = b.attackFacing = facing === 1 ? -1 : 1;
  return game;
}
it('accepts H+N in both facings, either key order and the three-frame chord window without repeating', () => {
  for (const facing of [1, -1] as const) for (const first of [h, n]) for (const gap of [0, 1, 2, 3]) {
    const game = setup(facing, 180), x = game.fighters[0].x;
    for (let f = 0; f < gap; f++) step(game, [input(facing, first), neutralInput()]);
    step(game, [input(facing), neutralInput()]);
    expect(game.fighters[0].moveId).toBe(id);
    expect(game.fighters[0].x).toBe(x + facing * 768);
    for (let f = 0; f < 200; f++) step(game, [input(facing), neutralInput()]);
    expect(game.fighters[0].attackId).toBe(1);
  }
});
it('preserves single high kicks and rejects wrong directions, crouching and late chords', () => {
  for (const [raw, want] of [[input(1, h), 'spin_hk'], [input(1, n), 'standing_rhk']] as const) {
    const game = setup(1); step(game, [raw, neutralInput()]); expect(game.fighters[0].moveId).toBe(want);
  }
  for (const raw of [{ ...neutralInput(), buttons: h | n }, input(-1), { ...input(1), down: true }]) {
    const game = setup(1); step(game, [raw, neutralInput()]); expect(game.fighters[0].moveId).not.toBe(id);
  }
  for (const first of [h, n]) {
    const game = setup(1); for (let f = 0; f < 4; f++) step(game, [input(1, first), neutralInput()]);
    step(game, [input(1), neutralInput()]); expect(game.fighters[0].moveId).not.toBe(id);
  }
});
it('keeps each knee raised between middle and high with a grounded support foot', () => {
  for (const facing of [1, -1]) for (const [side, support, start] of [['right', 'left', 17], ['left', 'right', 49]] as const) {
    for (let f = start; f <= start + 14; f += .25) {
      const p = samplePose(id, f, facing);
      expect(p[`${side}Foot`][1]).toBeLessThan(-20);
      expect(p[`${side}Knee`][1]).toBeLessThan(p.hip[1]);
      expect(Math.abs(p[`${support}Foot`][1])).toBeLessThan(.01);
    }
    const middle = samplePose(id, start + 2, facing), chamber = samplePose(id, start + 7, facing), high = samplePose(id, start + 12, facing);
    expect(chamber[`${side}Foot`][0] * facing).toBeLessThan(middle[`${side}Foot`][0] * facing - 15);
    expect(Math.hypot(chamber[`${side}Foot`][0] - chamber.hip[0], chamber[`${side}Foot`][1] - chamber.hip[1])).toBeLessThan(25);
    expect(high[`${side}Foot`][1]).toBeLessThan(middle[`${side}Foot`][1] - 10);
  }
});
it('lands all five strikes once in the requested order in both facings', () => {
  const groups = ['rightMiddle', 'rightHigh', 'leftMiddle', 'leftHigh', 'punch'];
  expect(MOVES[id].hitGroups.map(g => g.id)).toEqual(groups);
  for (const facing of [1, -1] as const) {
    const game = setup(facing); step(game, [input(facing), neutralInput()]);
    for (let f = 0; f < 220; f++) step(game, [neutralInput(), neutralInput()]);
    expect(game.fighters[0].hitTargets).toEqual(groups.map(g => `${g}:1`));
    expect(game.fighters[1].hp).toBe(630);
  }
  expect(classifyHit(id, 'punch')).toEqual({ kind: 'punch', strength: 'middle' });
  expect(swingCues(id)).toHaveLength(5);
  expect(sampleTurn(id, 80)).toBe(1);
  expect(sampleTurn(id, 96)).toBe(0);
});
