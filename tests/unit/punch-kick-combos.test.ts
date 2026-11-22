import { describe, expect, it } from 'vitest';
import rig from '../../src/data/poses.json';
import rules from '../../src/data/rules.json';
import { MOVES } from '../../src/data/schema';
import { createGame, step } from '../../src/simulation/state';
import { isActionable } from '../../src/simulation/movement';
import { buttonBit, neutralInput, type RawInput } from '../../src/input/types';
import { animationTrails, samplePose, sampleTurn } from '../../src/render/skeleton';
import { classifyHit, swingCues } from '../../src/platform/hit-sound';
import { createReplay, parseReplay, playReplay } from '../../src/debug/replay';

/**
 * punch_kick_combo: forward + MP + RHK (medium jab → right high kick).
 * kick_punch_combo: back + MK + HP (right middle kick → body hook).
 * The single moves on those directions are standing_mp/standing_rhk and
 * spin_mk/standing_hp; they stay reachable on their own.
 */
const COMBOS = [
  { id: 'punch_kick_combo', direction: 6, keys: ['MP', 'RHK'], singles: ['standing_mp', 'standing_rhk'], groups: ['punch', 'kick'], kinds: ['punch', 'kick'], levels: ['MID', 'HIGH'] },
  { id: 'kick_punch_combo', direction: 4, keys: ['MK', 'HP'], singles: ['spin_mk', 'standing_hp'], groups: ['kick', 'punch'], kinds: ['kick', 'punch'], levels: ['MID', 'MID'] },
] as const;
type Combo = typeof COMBOS[number];
const mask = (combo: Combo) => buttonBit(combo.keys[0]) | buttonBit(combo.keys[1]);
/** Held direction relative to the attacker's facing (6 forward, 4 back, 5 neutral). */
const held = (facing: number, direction: number, buttons = 0): RawInput => ({ ...neutralInput(),
  right: direction === 6 ? facing === 1 : direction === 4 ? facing === -1 : false,
  left: direction === 6 ? facing === -1 : direction === 4 ? facing === 1 : false, buttons });
/** Defender guard towards the attacker: back, optionally crouching. */
const guard = (attackerFacing: number, crouch: boolean): RawInput => ({ ...neutralInput(), right: attackerFacing === 1, left: attackerFacing === -1, down: crouch });
function setup(facing: 1 | -1, distance = 250, wall = false) {
  const game = createGame(), [a, b] = game.fighters;
  if (wall) { b.x = facing === 1 ? rules.stageWidth - 26 * rules.unit : 26 * rules.unit; a.x = b.x - facing * distance * rules.unit; }
  else { a.x = 450 * rules.unit; b.x = a.x + facing * distance * rules.unit; }
  a.facing = a.attackFacing = facing; b.facing = b.attackFacing = -facing as 1 | -1;
  return game;
}

describe.each(COMBOS)('$id', combo => {
  const move = MOVES[combo.id];

  it('starts from the chord in both facings, either key order and up to three frames apart, without repeating', () => {
    for (const facing of [1, -1] as const) for (const order of [combo.keys, [...combo.keys].reverse()]) for (let gap = 0; gap <= 3; gap++) {
      const game = setup(facing), fighter = game.fighters[0];
      step(game, [held(facing, combo.direction), neutralInput()]);
      const x = fighter.x;
      for (let i = 0; i < gap; i++) step(game, [held(facing, combo.direction, buttonBit(order[0])), neutralInput()]);
      step(game, [held(facing, combo.direction, mask(combo)), neutralInput()]);
      expect(fighter.moveId, `${order.join('→')} gap ${gap}`).toBe(combo.id);
      expect(fighter.attackFacing).toBe(facing);
      // Only the walk step of the chord frame itself moves the fighter; a
      // single started by the first key and its advance are undone.
      expect(fighter.x).toBe(x + facing * (combo.direction === 6 ? rules.forwardSpeed : -rules.backwardSpeed));
      for (let i = 0; i < 120; i++) step(game, [held(facing, combo.direction, mask(combo)), neutralInput()]);
      expect(fighter.attackId).toBe(1);
    }
  });

  it('keeps both single moves and rejects late chords, neutral, the other direction and crouching', () => {
    for (const facing of [1, -1] as const) {
      combo.keys.forEach((key, index) => {
        const game = setup(facing); step(game, [held(facing, combo.direction, buttonBit(key)), neutralInput()]);
        expect(game.fighters[0].moveId).toBe(combo.singles[index]);
      });
      for (const raw of [held(facing, 5, mask(combo)), held(facing, 10 - combo.direction, mask(combo)), { ...held(facing, combo.direction, mask(combo)), down: true }]) {
        const game = setup(facing); step(game, [raw, neutralInput()]);
        expect(game.fighters[0].moveId).not.toBe(combo.id);
      }
      for (const key of combo.keys) {
        const game = setup(facing);
        for (let i = 0; i < 4; i++) step(game, [held(facing, combo.direction, buttonBit(key)), neutralInput()]);
        step(game, [held(facing, combo.direction, mask(combo)), neutralInput()]);
        expect(game.fighters[0].moveId).not.toBe(combo.id);
      }
    }
  });

  it('declares two ordered hit groups whose damage stays below the spin high → middle combo', () => {
    expect(move.hitGroups.map(group => group.id)).toEqual(combo.groups);
    expect(move.hitGroups.map(group => group.hitLevel ?? move.hitLevel)).toEqual(combo.levels);
    const total = move.hitGroups.reduce((sum, group) => sum + (group.damage ?? move.damage), 0);
    expect(total).toBe(150);
    expect(total).toBeLessThan(MOVES.spin_high_middle_combo.hitGroups.reduce((sum, group) => sum + (group.damage ?? 0), 0));
    // The finisher pushes back like the other combos; the opener keeps the opponent in reach.
    expect([move.pushbackHit, move.pushbackBlock]).toEqual([0, 0]);
    expect([move.hitGroups[1].pushbackHit, move.hitGroups[1].pushbackBlock]).toEqual([5632, 4096]);
    expect(combo.groups.map(group => classifyHit(combo.id, group).kind)).toEqual(combo.kinds);
    expect(swingCues(combo.id).map(cue => cue.groupId)).toEqual(combo.groups);
    expect(animationTrails(combo.id).map(trail => trail.joint)).toEqual(combo.id === 'punch_kick_combo' ? ['leftHand', 'rightFoot'] : ['rightFoot', 'leftHand']);
  });

  it.each([30, 45, 60, 75])('lands both hits once and in order on a standing opponent at %i px, in both facings, replayable', distance => {
    for (const facing of [1, -1] as const) {
      const game = setup(facing, distance), replay = createReplay(game);
      let between = false;
      for (let frame = 0; frame < 90; frame++) {
        const inputs: [RawInput, RawInput] = [frame === 0 ? held(facing, combo.direction, mask(combo)) : neutralInput(), neutralInput()];
        replay.frames.push({ inputs, events: [] }); step(game, inputs);
        if (game.fighters[0].hitTargets.length === 1 && isActionable(game.fighters[1])) between = true;
      }
      expect(game.fighters[0].hitTargets).toEqual(combo.groups.map(group => `${group}:1`));
      expect(game.fighters[1].hp).toBe(850);
      expect(between, 'the opponent may not act between both hits').toBe(false);
      expect(playReplay(parseReplay(replay))).toEqual(game);
    }
  });

  // Inside the crouching reach of the opener (the middle kick reaches crouchers up to ~55 px).
  it.each([42, 52])('keeps the opponent in blockstun until the second hit at %i px', distance => {
    for (const facing of [1, -1] as const) {
      // Against the wall, so holding back cannot walk out of range.
      const game = setup(facing, distance, true), [a, b] = game.fighters;
      const contacts: string[] = [];
      for (let frame = 0; frame < 90; frame++) {
        // Correct guard for the next hit: MID is blocked crouching, HIGH standing.
        const next = combo.levels[Math.min(1, a.hitTargets.length)];
        const before = a.hitTargets.length;
        step(game, [frame === 0 ? held(facing, combo.direction, mask(combo)) : neutralInput(), guard(facing, next !== 'HIGH')]);
        if (a.hitTargets.length > before) contacts.push(`${a.hitTargets.at(-1)}:${game.lastContact?.blocked ? 'block' : 'hit'}`);
        if (a.hitTargets.length === 1) expect(['Blockstun', 'KO']).toContain(b.state);
      }
      expect(contacts).toEqual(combo.groups.map(group => `${group}:1:block`));
      expect(b.hp).toBeGreaterThan(985);
    }
  });

  it('keeps fixed bone lengths, never sinks below the floor and ends in the idle pose', () => {
    for (const facing of [1, -1] as const) {
      for (let frame = 0; frame < move.duration; frame += .5) {
        const pose = samplePose(combo.id, frame, facing);
        expect(Math.max(pose.leftFoot[1], pose.rightFoot[1]), `${frame}`).toBeLessThan(1e-6);
        for (const bone of rig.skeleton.bones)
          expect(Math.hypot(pose[bone.parent][0] - pose[bone.joint][0], pose[bone.parent][1] - pose[bone.joint][1])).toBeCloseTo(bone.length, 6);
      }
      expect(samplePose(combo.id, move.duration - 1, facing)).toEqual(samplePose('Idle', 0, facing));
      expect(samplePose(combo.id, 0, facing)).toEqual(samplePose('Idle', 0, facing));
    }
    expect(sampleTurn(combo.id, 0)).toBe(0);
    expect(sampleTurn(combo.id, move.duration - 1)).toBe(0);
  });
});

describe('punch_kick_combo motion', () => {
  it('turns through the jab, returns to 0 in the guard and kicks high on a planted left foot', () => {
    const id = 'punch_kick_combo';
    expect(sampleTurn(id, 8)).toBe(1);
    expect(sampleTurn(id, 14)).toBe(0);
    for (const facing of [1, -1] as const) {
      const jab = samplePose(id, 8, facing), kick = samplePose(id, 20, facing);
      expect((jab.leftHand[0] - jab.neck[0]) * facing).toBeGreaterThan(25);
      expect(kick.rightFoot[1]).toBeLessThan(kick.head[1] + 10);
      // Guard transition between the hits: both hands back in front of the chest.
      const guard = samplePose(id, 14, facing);
      for (const side of ['left', 'right']) expect((guard[`${side}Hand`][0] - guard.neck[0]) * facing).toBeGreaterThan(-2);
      const support = samplePose(id, 0, facing).leftFoot;
      for (let frame = 0; frame < MOVES[id].duration; frame += .5) {
        const p = samplePose(id, frame, facing);
        // Exact on baked frames; angle interpolation in between may lift it a hair.
        const tolerance = Number.isInteger(frame) ? 1e-3 : .1;
        expect(Math.abs(p.leftFoot[0] - support[0]), `${frame}`).toBeLessThan(tolerance);
        expect(Math.abs(p.leftFoot[1]), `${frame}`).toBeLessThan(tolerance);
      }
    }
  });
});

describe('kick_punch_combo motion', () => {
  it('keeps the support foot planted through the kick and turns the body into the hook', () => {
    const id = 'kick_punch_combo';
    for (const facing of [1, -1] as const) {
      const support = samplePose(id, 0, facing).leftFoot;
      for (let frame = 0; frame <= 26; frame += .25) {
        const p = samplePose(id, frame, facing);
        // Exact on baked frames; angle interpolation in between may lift it a hair.
        const tolerance = Number.isInteger(frame) ? 1e-3 : .1;
        expect(Math.abs(p.leftFoot[0] - support[0]), `${frame}`).toBeLessThan(tolerance);
        expect(Math.abs(p.leftFoot[1]), `${frame}`).toBeLessThan(tolerance);
      }
      const kick = samplePose(id, 17, facing), hook = samplePose(id, 30, facing);
      expect((kick.rightFoot[0] - kick.hip[0]) * facing).toBeGreaterThan(40);
      // Body hook: the fist arrives in front of the body below shoulder height.
      expect((hook.leftHand[0] - hook.neck[0]) * facing).toBeGreaterThan(20);
      expect(hook.leftHand[1]).toBeGreaterThan(hook.leftShoulder[1]);
      expect(Math.abs(hook.rightFoot[1])).toBeLessThan(1e-6);
    }
    expect(sampleTurn(id, 26)).toBe(0);
    expect(sampleTurn(id, 30)).toBe(1);
  });
});
