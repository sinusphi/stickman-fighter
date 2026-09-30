import { expect, it } from 'vitest';
import { MOVES, groupValue, validateMoves, type HitGroup } from '../../src/data/schema';
import moveData from '../../src/data/moves.json';
import contactGeometry from '../../src/data/contact-geometry.json';
import { animations, animationTrails, samplePose } from '../../src/render/skeleton';
import { kneeImpact } from '../../src/render/impact';
import { createGame, step, snapshot } from '../../src/simulation/state';
import { buttonBit, neutralInput, type Button, type RawInput } from '../../src/input/types';
import { createReplay, parseReplay, playReplay, validateSnapshot } from '../../src/debug/replay';
import type { GameState } from '../../src/simulation/types';

// Standing middle/high kicks raise the knee to chest height before the kick
// (user screenshots 29.09.: right middle frame 15, right high frame 14).
const KICKS: [Button, string, 'left'|'right', number][] = [
  ['MK','standing_mk','right',15], ['LMK','standing_lmk','left',15],
  ['HK','standing_hk','left',14], ['RHK','standing_rhk','right',14],
];
const knee = (id: string): HitGroup => MOVES[id].hitGroups.find(g => g.id === 'knee')!;
const geometry = contactGeometry as unknown as Record<string, { frames: { strikes: Record<string, number[]> }[] }>;

function duel(distance: number, attackerOnRight = false): GameState {
  const game = createGame(), [a, b] = game.fighters;
  a.x = (attackerOnRight ? 600 : 400) * 256; b.x = a.x + (attackerOnRight ? -distance : distance) * 256;
  return game;
}
/** Plays one kick of P1 and records every damage step of P2. */
function play(button: Button, distance: number, attackerOnRight = false, defender: (i: number) => RawInput = () => neutralInput()) {
  const game = duel(distance, attackerOnRight), hits: { damage: number; frame: number; state: string; combo: number }[] = [];
  const replay = createReplay(game);
  for (let i = 0; i < 70; i++) {
    const before = game.fighters[1].hp, inputs: [RawInput, RawInput] = [{ ...neutralInput(), buttons: i === 0 ? buttonBit(button) : 0 }, defender(i)];
    replay.frames.push({ inputs, events: [] }); step(game, inputs);
    const [a, b] = game.fighters;
    if (b.hp < before) hits.push({ damage: before - b.hp, frame: a.moveFrame, state: b.state, combo: a.comboCount });
  }
  return { game, hits, replay };
}

it('adds a separate MID knee group whose window ends on the raised-knee pose of the screenshots', () => {
  for (const [, id, side, apex] of KICKS) {
    const move = MOVES[id], group = knee(id);
    expect(move.multiHit).toBe(true);
    expect(move.hitGroups.find(g => g.id === 'main')).toEqual({ id: 'main', maxHitsPerTarget: 1 });
    expect(group).toMatchObject({ maxHitsPerTarget: 1, hitLevel: 'MID', damage: 30, activeFrames: [apex - 2, apex] });
    // Final knee position = anticipation keyframe = highest knee before the kick extends.
    expect(animations[id].keyframes.find(k => k.pose.endsWith('_anticipate'))!.frame).toBe(apex);
    // The knee rises all the way into the apex (the kick then extends from there).
    const heights = Array.from({ length: apex + 1 }, (_, f) => samplePose(id, f)[`${side}Knee`][1]);
    expect(Math.min(...heights)).toBe(heights[apex]);
    const pose = samplePose(id, apex);
    expect(pose[`${side}Knee`][0]).toBeGreaterThan(pose.hip[0] + 15);
    expect(pose[`${side}Knee`][1]).toBeLessThan(pose.hip[1] - 12);
    expect(group.activeFrames![1]).toBeLessThan(move.startup);
  }
});

it('bakes the knee capsule on the rendered kneecap and hitboxes only inside the knee window', () => {
  for (const [, id, side] of KICKS) {
    const [from, to] = knee(id).activeFrames!;
    MOVES[id].frames.forEach((frame, f) => {
      const inWindow = f >= from && f <= to, strike = geometry[id].frames[f].strikes.knee;
      expect(frame.hitboxes.some(b => b.hitGroup === 'knee'), `${id}/${f}`).toBe(inWindow);
      expect(Boolean(strike), `${id}/${f}`).toBe(inWindow);
      if (!inWindow) return;
      const point = samplePose(id, f)[`${side}Knee`];
      expect(strike.slice(2, 4)).toEqual(point.map(v => Math.round(v * 256)));
    });
  }
});

it.each([false, true])('lands knee then kick up close and only the kick from farther away (attacker on right: %s)', onRight => {
  for (const [button, id] of KICKS) {
    const main = MOVES[id], group = knee(id), [from, to] = group.activeFrames!;
    const close = play(button, 45, onRight);
    expect(close.hits.map(h => h.damage), id).toEqual([30, main.damage]);
    expect(close.hits[0].frame).toBeGreaterThanOrEqual(from); expect(close.hits[0].frame).toBeLessThanOrEqual(to);
    expect(close.hits[1].frame).toBe(main.startup);
    // The knee's short stun and small push keep the kick connecting as a true combo.
    expect(close.hits[1].combo, id).toBe(2);
    const far = play(button, main.advance ? 80 : 70, onRight);
    expect(far.hits.map(h => h.damage), id).toEqual([main.damage]);
  }
});

it('uses the knee reactions for the knee and the unchanged kick reactions for the kick', () => {
  for (const [button, id] of KICKS) {
    const move = MOVES[id], group = knee(id), game = duel(45);
    let kneeContact: GameState | undefined;
    for (let i = 0; i < 40 && !kneeContact; i++) {
      step(game, [{ ...neutralInput(), buttons: i === 0 ? buttonBit(button) : 0 }, neutralInput()]);
      if (game.hitstop) kneeContact = game;
    }
    expect(game.hitstop, id).toBe(groupValue(move, group, 'hitstop'));
    expect(game.fighters[1].state).toBe('Hitstun');
    expect(game.fighters[1].remaining).toBe(group.hitstun);
    expect(group.hitstun).toBeLessThan(move.hitstun); expect(group.pushbackHit).toBeLessThan(move.pushbackHit);
    expect(game.lastContact?.hitLevel).toBe('MID');
    for (let i = 0; i < 40 && !(game.hitstop && game.fighters[0].moveFrame >= move.startup); i++) step(game);
    expect(game.fighters[0].moveFrame).toBe(move.startup);
    expect(game.hitstop).toBe(move.hitstop);
    expect(game.fighters[1].remaining).toBe(move.hitstun);
  }
});

it('is blocked like any MID hit, standing or crouch-guarding', () => {
  // Guard only from shortly before the knee, so holding back cannot walk out of range.
  for (const [button, id] of KICKS) for (const down of [false, true]) {
    const [from] = knee(id).activeFrames!, guard = (i: number) => ({ ...neutralInput(), right: i >= from - 2, down });
    const { game, hits } = play(button, 42, false, guard);
    expect(hits, id).toEqual([]); expect(game.fighters[1].hp).toBe(1000);
    const first = duel(42);
    for (let i = 0; i < 40 && !first.lastContact; i++) step(first, [{ ...neutralInput(), buttons: i === 0 ? buttonBit(button) : 0 }, guard(i)]);
    expect(first.lastContact?.blocked, id).toBe(true);
    expect(first.fighters[0].moveFrame, id).toBeLessThanOrEqual(knee(id).activeFrames![1]);
    expect(first.fighters[1].state).toBe('Blockstun'); expect(first.fighters[1].remaining).toBe(knee(id).blockstun);
  }
});

it('leaves crouching and airborne middle/high kicks without a knee strike', () => {
  for (const stance of ['crouching', 'airborne']) for (const suffix of ['mk', 'lmk', 'hk', 'rhk']) {
    const move = MOVES[`${stance}_${suffix}`];
    expect(move.hitGroups.map(g => g.id)).toEqual(['main']); expect(move.multiHit).toBe(false);
  }
});

it('replays knee and kick deterministically, also from a snapshot inside the knee hitstop', () => {
  const { game, replay } = play('HK', 45);
  expect(playReplay(parseReplay(replay))).toEqual(game);
  const again = duel(45); let frozen: GameState | undefined, cut = 0;
  replay.frames.forEach((entry, i) => {
    step(again, entry.inputs);
    if (!frozen && again.hitstop) { frozen = validateSnapshot(JSON.parse(JSON.stringify(snapshot(again)))); cut = i + 1; }
  });
  for (const entry of replay.frames.slice(cut)) step(frozen!, entry.inputs);
  expect(frozen).toEqual(game);
});

it('draws a knee trail up to the apex and a burst only during the knee hitstop', () => {
  for (const [button, id, side] of KICKS) {
    const trail = animationTrails(id).find(t => t.joint === `${side}Knee`)!;
    expect(trail.toFrame).toBe(knee(id).activeFrames![1]); expect(trail.fromFrame).toBeLessThan(knee(id).activeFrames![0]);
    const game = duel(45); let seen = 0;
    for (let i = 0; i < 40; i++) {
      step(game, [{ ...neutralInput(), buttons: i === 0 ? buttonBit(button) : 0 }, neutralInput()]);
      const burst = kneeImpact(game, game.fighters[0]);
      if (game.hitstop && game.fighters[0].moveFrame < MOVES[id].startup) {
        expect(burst?.joint).toBe(`${side}Knee`); expect(burst!.strength).toBeCloseTo(game.hitstop / knee(id).hitstop!, 8); seen++;
      } else expect(burst, `${id}/${i}`).toBeNull();
    }
    expect(seen).toBe(knee(id).hitstop);
  }
});

it('rejects knee boxes outside their own window and malformed knee frame data', () => {
  const shifted = structuredClone(moveData), mk = shifted.find(m => m.id === 'standing_mk')!;
  (mk.hitGroups[1] as HitGroup).activeFrames = [14, 15];
  expect(() => validateMoves(shifted)).toThrow(/Fensters von knee/);
  const bad = structuredClone(moveData);
  (bad.find(m => m.id === 'standing_hk')!.hitGroups[1] as HitGroup).hitstun = -1;
  expect(() => validateMoves(bad)).toThrow(/Frame-Data der Treffergruppe/);
  const late = structuredClone(moveData);
  (late.find(m => m.id === 'standing_rhk')!.hitGroups[1] as HitGroup).activeFrames = [12, 99];
  expect(() => validateMoves(late)).toThrow(/Trefferfenster/);
});

it('pushes the knee swoosh just in front of the kneecap and only around the rise', async () => {
  const { sampleKneeSwoosh, KNEE_SWOOSH_OFFSET } = await import('../../src/render/skeleton');
  for (const [, id, side] of KICKS) {
    const trail = animationTrails(id).find(t => t.joint === `${side}Knee`)!;
    expect(sampleKneeSwoosh(id, trail.fromFrame - 1, trail)).toEqual([]);
    expect(sampleKneeSwoosh(id, trail.toFrame + trail.historyFrames + .5, trail)).toEqual([]);
    const points = sampleKneeSwoosh(id, trail.toFrame, trail), pose = samplePose(id, trail.toFrame), end = points.at(-1)!;
    expect(points.length).toBeGreaterThan(2);
    expect(Math.hypot(end[0] - pose[`${side}Knee`][0], end[1] - pose[`${side}Knee`][1])).toBeCloseTo(KNEE_SWOOSH_OFFSET, 8);
    expect(Math.hypot(end[0] - pose.hip[0], end[1] - pose.hip[1])).toBeCloseTo(25 + KNEE_SWOOSH_OFFSET, 6);
    // The swoosh rises: it ends clearly above where it starts.
    expect(end[1]).toBeLessThan(points[0][1] - 8);
  }
});
