import { expect, it } from 'vitest';
import { MOVES, validateMoves } from '../../src/data/schema';
import moveData from '../../src/data/moves.json';
import poses from '../../src/data/poses.json';
import { animations, samplePose } from '../../src/render/skeleton';
import { usesPoseContact } from '../../src/simulation/pose-contact';
import { createGame, step } from '../../src/simulation/state';
import { neutralInput, buttonBit } from '../../src/input/types';
import type { RawInput } from '../../src/input/types';
import contactGeometry from '../../src/data/contact-geometry';

const ID = 'left_turn_kick';
const back = (facing: number, button = false): RawInput =>
  ({ ...neutralInput(), left: facing === 1, right: facing === -1, buttons: button ? buttonBit('LK') : 0 });

function setup(facing: 1 | -1 = 1) {
  const game = createGame();
  game.fighters[0].x = (facing === 1 ? 300 : 660) * 256; game.fighters[1].x = (facing === 1 ? 660 : 300) * 256;
  game.fighters[0].facing = game.fighters[0].attackFacing = facing; game.fighters[1].facing = -facing as 1 | -1;
  return game;
}

it('trägt die Framedata (linker Tritt, Drehung, rechtes Knie)', () => {
  const move = MOVES[ID];
  expect([move.startup, move.active, move.recovery]).toEqual([18, 4, 44]);
  expect(move.duration).toBe(66);
  expect([move.damage, move.hitLevel, move.hitstun, move.blockstun, move.hitstop]).toEqual([70, 'HIGH', 26, 18, 10]);
  expect(move.button).toBe('LK');
  expect(move.command).toMatchObject({ type: 'hold', directions: [4], buttons: ['LK'], trigger: 'pressed' });
  expect(move.advance).toBeUndefined();
  expect(animations[ID].durationFrames).toBe(move.duration);
  expect(validateMoves(moveData)).toBeTruthy();
});

it('startet auf "Zurück halten + LK" in beiden Blickrichtungen, egal wie lange zurück gehalten wird', () => {
  for (const facing of [1, -1] as const) for (const held of [0, 1, 20]) {
    const game = setup(facing);
    for (let i = 0; i < held; i++) step(game, [back(facing), neutralInput()]);
    step(game, [back(facing, true), neutralInput()]);
    expect(game.fighters[0].moveId).toBe(ID);
    expect(game.fighters[0].moveFrame).toBe(0);
    expect(game.fighters[0].attackFacing).toBe(facing);
  }
});

it('bleibt ohne gehaltenes Zurück der normale LK, auch nach dem Loslassen', () => {
  for (const facing of [1, -1] as const) for (const scenario of ['neutral', 'released'] as const) {
    const game = setup(facing);
    if (scenario === 'released') { step(game, [back(facing), neutralInput()]); step(game); }
    step(game, [{ ...neutralInput(), buttons: buttonBit('LK') }, neutralInput()]);
    expect(game.fighters[0].moveId).toBe('standing_lk');
  }
});

it('löst nicht in der Hocke, im Sprung oder aus der Luft aus', () => {
  for (const posture of ['crouch', 'jump', 'air'] as const) {
    const game = setup(), f = game.fighters[0];
    if (posture === 'air') { f.state = 'Airborne'; f.y = -100 * 256; f.vy = 0; }
    step(game, [{ ...back(1, true), down: posture === 'crouch', up: posture === 'jump' }, neutralInput()]);
    expect(f.moveId).not.toBe(ID);
  }
});

it('trifft nur in den Active-Frames und mit dem linken Fuß, Kontakt über die Pose', () => {
  const move = MOVES[ID];
  for (let frame = 0; frame < move.duration; frame++) {
    const active = frame >= move.startup && frame < move.startup + move.active;
    expect(move.frames[frame].hitboxes.length > 0).toBe(active);
    if (!active) continue;
    // Die Trefferkapsel Knie→Fuß wird in mehrere Boxen zerlegt; der Fuß liegt in einer davon.
    const foot = samplePose(ID, frame, 1).leftFoot;
    expect(move.frames[frame].hitboxes.some(box =>
      foot[0] * 256 >= box.x && foot[0] * 256 <= box.x + box.width &&
      foot[1] * 256 >= box.y && foot[1] * 256 <= box.y + box.height)).toBe(true);
  }
  expect(usesPoseContact(ID)).toBe(true);
  const geometry = contactGeometry as unknown as Record<string, { frames: { strikes: Record<string, number[]> }[] }>;
  expect(geometry[ID].frames.filter(f => f.strikes.main).length).toBe(move.active);
});

it('beginnt und endet in der Grundstellung', () => {
  const keys = animations[ID].keyframes;
  for (const key of [keys[0], keys.at(-1)!]) {
    expect((poses.poses as Record<string, unknown>)[key.pose]).toEqual(
      { ...poses.poses.guard, root: (poses.poses as Record<string, { root: number[] }>)[key.pose].root });
  }
  expect(keys.at(-1)!.frame).toBe(animations[ID].durationFrames - 1);
});


it('führt den linken Tritt über ein gepflanztes rechtes Bein und hebt erst danach das rechte Knie', () => {
  for (const facing of [1, -1] as const) {
    for (let frame = 10; frame <= 26; frame++) {
      const pose = samplePose(ID, frame, facing);
      expect(Math.abs(pose.rightFoot[1])).toBeLessThan(.1);
      expect(pose.leftFoot[1]).toBeLessThan(-8);
    }
    const hit = samplePose(ID, 18, facing);
    expect((hit.leftFoot[0] - hit.hip[0]) * facing).toBeGreaterThan(35);
    expect(hit.leftFoot[1]).toBeLessThan(-78);
    for (let frame = 41; frame <= 50; frame++) {
      const pose = samplePose(ID, frame, facing);
      expect(Math.abs(pose.leftFoot[1])).toBeLessThan(.1);
      expect(pose.rightKnee[1]).toBeLessThan(pose.hip[1] - 20);
      expect(MOVES[ID].frames[frame].hitboxes).toHaveLength(0);
    }
  }
  const keys = animations[ID].keyframes;
  for (let i = 1; i < keys.length; i++) expect(keys[i].yaw!).toBeGreaterThanOrEqual(keys[i - 1].yaw!);
  expect(keys.at(-1)!.yaw).toBe(360);
});

it('trifft nah genau einmal und verfehlt außerhalb der sichtbaren Reichweite in beiden Richtungen', () => {
  for (const facing of [1, -1] as const) for (const distance of [60, 150]) {
    const game = setup(facing), [a, b] = game.fighters;
    b.x = a.x + facing * distance * 256;
    const hp = b.hp;
    step(game, [back(facing, true), neutralInput()]);
    for (let i = 0; i < MOVES[ID].duration + 15; i++) step(game);
    expect(hp - b.hp).toBe(distance === 60 ? MOVES[ID].damage : 0);
  }
});
