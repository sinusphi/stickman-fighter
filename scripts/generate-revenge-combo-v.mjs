/**
 * Revenge combo V: quarter circle forward (down, down-forward, forward) + RLK with a
 * full Revenge bar. The "salvo": three quick punches, a low-kick mix-up, a
 * double left kick and a rising uppercut that knocks down.
 *
 *   hook, jab, hook, right low kick, left middle, left high, uppercut
 *
 * What sets it apart from the other two Revenge combos:
 *  - the opener is a step-in body hook (MID), so the first guard is crouching,
 *    where `revenge_combo` opens HIGH and `revenge_combo_f` opens LOW,
 *  - the punches come first and fast (8 / 9 frame rhythm), then the combo
 *    drops to the shin for a right low kick (the only LOW hit of this variant),
 *    climbs back with the left leg (middle, then high on the same raised knee)
 *    and ends in a rising uppercut from a deep dip of the hips,
 *  - the finisher is the only uppercut of the three: both feet planted, knees
 *    bent, the fist travelling up the opponent's chin.
 *
 * Footwork, so no support foot ever slides (ground positions are in the
 * coordinates of frame 0; the move advances STEP over the first two punches):
 *  - hook: the lead (left) foot steps in and lands with it,
 *  - jab: the rear (right) foot follows with a pivot step under the hip,
 *  - the right leg kicks low from the planted left foot and lands where it was,
 *  - the left knee comes up from the planted right foot, only the shin folds
 *    between the middle and the high kick,
 *  - the left foot sets down, the uppercut rises on both planted feet and the
 *    right foot steps back onto its guard spot while the stance recovers.
 */
import { readFile } from 'node:fs/promises';
import { generateKick } from './kicks/generate.mjs';
import { toAbsolute } from './kicks/rig.mjs';
const data = JSON.parse(await readFile(new URL('../src/data/poses.json', import.meta.url), 'utf8'));
await generateKick(G => {
  const L0 = G.leftFoot[0], R0 = G.rightFoot[0];
  const STEP = 18, STEP_FRAMES = 16;
  // Feet after the step-in: lead foot, rear foot under the hip, rear foot on its guard spot.
  const L = L0 + STEP, R1 = -5 + STEP, R = R0 + STEP;
  const ground = (x, y = 0) => ({ foot: [x, y], knee: 1, space: 'ground' });
  const abs = name => toAbsolute(data.poses[name]);
  // Punches on two planted feet.
  const planted = (f, name, hip, right = ground(R1), left = ground(L)) => ({ f, ...abs(name), hip, left, right });
  // The jab is aimed at chin height, a little lower than the standing light punch.
  const JAB_DROP = 28, JAB_LEAN = 6;
  const jab = (f, name, hip, right) => {
    const p = planted(f, name, hip, right);
    return { ...p, torso: p.torso + JAB_LEAN, arms: { ...p.arms, l: [p.arms.l[0] + JAB_DROP, p.arms.l[1] + JAB_DROP + 12] } };
  };
  // The hooks go to the body, a little lower and longer than the standing medium punch.
  const body = (f, name, hip, right, left) => {
    const p = planted(f, name, hip, right, left);
    return { ...p, arms: { ...p.arms, l: [p.arms.l[0] - 14, p.arms.l[1] + 10] } };
  };
  // The opening hook must also catch a crouching opponent (head box tops out at 54 px): arm and torso lower than the body hook.
  const lowHook = (f, name, hip, right) => {
    const p = planted(f, name, hip, right);
    return { ...p, torso: p.torso + 8, arms: { ...p.arms, l: [58, 32] } };
  };
  // Kicks: the authored kick pose on one planted support foot.
  const onRight = (f, name, hip) => ({ f, ...abs(name), hip, right: ground(R1) });
  const onLeft = (f, name, hip) => ({ f, ...abs(name), hip, left: ground(L) });
  // High kick straight out of the raised knee, extended so it reaches as far as the middle kick.
  const high = (f, hip) => ({ ...onRight(f, 'standing_hk', hip), torso: -86, head: -81, left: { thigh: -38, shin: -28 } });
  // The uppercut: both feet planted, the fist travels up the front of the opponent.
  const upper = (f, hip, torso, arm) => {
    const p = abs('standing_hp');
    return { f, ...p, hip, torso, arms: { ...p.arms, l: arm }, left: ground(L), right: ground(R1) };
  };
  const keys = [
    { f: 0, ...G, left: ground(L0), right: ground(R0) },
    // 1. Step-in body hook (lead hand): the lead foot lands with the punch.
    planted(4, 'standing_mp_anticipate', [-1, -47], ground(R0), ground((L0 + L) / 2, -6)),
    lowHook(8, 'standing_mp', [-3, -45.4], ground(R0)),
    lowHook(10, 'standing_mp', [-2.8, -45.4], ground(R0)),
    // 2. Jab: the rear foot follows with a pivot step and lands with the punch.
    planted(13, 'standing_lp_anticipate', [0, -46.8], ground((R0 + R1) / 2, -6)),
    jab(16, 'standing_lp', [-2, -46.6], ground(R1)),
    jab(17, 'standing_lp', [-1.8, -46.6], ground(R1)),
    // 3. Second hook on two planted feet.
    planted(20, 'standing_mp_anticipate', [0, -46.8]),
    body(25, 'standing_mp', [10, -45.2], ground(R1)),
    body(27, 'standing_mp', [10.2, -45.2], ground(R1)),
    // 4. Right low kick from the planted left foot; the foot lands where it started.
    planted(30, 'standing_mp_return', [-1, -47.4]),
    onLeft(31, 'standing_rlk_anticipate', [2, -48.4]),
    onLeft(34, 'standing_rlk', [3, -48.8]),
    onLeft(36, 'standing_rlk', [3, -48.8]),
    onLeft(38, 'standing_rlk_return', [2, -48.4]),
    // The right foot comes down from above, it never drags over the floor.
    { ...onLeft(39, 'standing_rlk_return', [1.5, -48.2]), right: ground(R1, -4) },
    planted(40, 'standing_mp_return', [-1, -47.4]),
    // 5. Weight over the right foot, the left knee comes up for the middle kick.
    { ...planted(42, 'standing_mp_return', [-1, -47.4]), left: ground(L - 3, -9) },
    onRight(44, 'standing_lmk_anticipate', [-2, -48.6]),
    onRight(47, 'standing_lmk', [-2, -49]),
    onRight(49, 'standing_lmk', [-2, -49]),
    // 6. Only the shin folds, the knee stays up for the high kick.
    onRight(52, 'standing_lmk_anticipate', [-1.5, -48.8]),
    onRight(53, 'standing_hk_anticipate', [-1, -48.8]),
    high(56, [0, -49]),
    high(58, [0, -49]),
    // 7. The left foot sets down, the hips dip and the uppercut rises.
    onRight(61, 'standing_hk_return', [-1, -48.4]),
    planted(64, 'standing_mp_return', [2, -47.6]),
    upper(66, [0, -44.3], -82, [80, 25]),
    upper(69, [9, -47.5], -70, [48, -74]),
    upper(71, [9.4, -47.6], -70, [48, -74]),
    upper(74, [7.5, -49], -76, [30, -98]),
    // The rear foot steps back onto its guard spot (it comes down from above, never drags).
    { ...planted(77, 'standing_hp_return', [3, -46.6]), right: ground(R1 - 6, -7) },
    { ...planted(80, 'standing_hp_return', [1, -46.9]), right: ground(R) },
    { f: 81, ...G, left: ground(L), right: ground(R) },
  ];
  const strikes = [
    { from: 8, to: 10, joint: 'leftHand', group: 'hookA', hit: { damage: 45, hitLevel: 'MID', hitstun: 14, blockstun: 15, hitstop: 8 } },
    { from: 16, to: 17, joint: 'leftHand', group: 'jab', hit: { damage: 40, hitLevel: 'HIGH', hitstun: 12, blockstun: 11, hitstop: 7 } },
    { from: 25, to: 27, joint: 'leftHand', group: 'hookB', hit: { damage: 60, hitLevel: 'MID', hitstun: 14, blockstun: 16, hitstop: 8 } },
    { from: 34, to: 36, joint: 'rightFoot', group: 'low', hit: { damage: 45, hitLevel: 'LOW', hitstun: 15, blockstun: 13, hitstop: 8 } },
    { from: 47, to: 49, joint: 'leftFoot', group: 'middle', hit: { damage: 65, hitLevel: 'MID', hitstun: 14, blockstun: 18, hitstop: 9 } },
    { from: 56, to: 58, joint: 'leftFoot', group: 'high', hit: { damage: 85, hitLevel: 'HIGH', hitstun: 17, blockstun: 23, hitstop: 10 } },
    // Knockdown via rules.hitStrength.overrides["revenge_combo_v:upper"]; only the finisher pushes.
    { from: 69, to: 71, joint: 'leftHand', group: 'upper', hit: { damage: 135, hitLevel: 'HIGH', hitstun: 30, blockstun: 22, hitstop: 14, pushbackHit: 5632, pushbackBlock: 4096 } },
  ];
  // Body turn of the punches (as authored for standing_mp), square again for the kicks.
  const turnTrack = [[0, 0], [4, 0], [8, 1], [10, 1], [13, .3], [16, 0], [18, 0], [22, .2], [25, 1], [27, 1], [31, .4], [34, 0], [64, 0], [67, .15], [69, .6], [71, .6], [74, .5], [77, .2], [81, 0]];
  return { id: 'revenge_combo_v', button: 'RLK', motion: '236+K', duration: 82, priority: 30,
    advance: { frames: STEP_FRAMES, distance: STEP },
    resource: 'revenge', standingHitstun: true,
    frame: { startup: 8, active: 64, recovery: 10 }, kickFoot: 'leftFoot',
    // Base values: no pushback, so every strike still reaches after the previous one.
    hit: { damage: 45, hitLevel: 'MID', hitstun: 14, blockstun: 15, pushbackHit: 0, pushbackBlock: 0, hitstop: 8 },
    strikes,
    hurtJoint: f => strikes.reduce((best, s) => Math.min(Math.abs(f - s.from), Math.abs(f - s.to)) < Math.min(Math.abs(f - best.from), Math.abs(f - best.to)) ? s : best).joint,
    turn: f => {
      const i = turnTrack.findIndex((_, i) => i + 1 < turnTrack.length && f <= turnTrack[i + 1][0]);
      const [a, b] = [turnTrack[i], turnTrack[i + 1]], t = (f - a[0]) / (b[0] - a[0]);
      return Math.round((a[1] + (b[1] - a[1]) * t) * 1e6) / 1e6;
    },
    // Shoulder girdle follows the keys that author it; the others inherit.
    shoulders: (_, f) => {
      const girdle = keys.filter(key => key.shoulders);
      const i = Math.max(0, girdle.findIndex((_, i) => i + 1 < girdle.length && f <= girdle[i + 1].f));
      const a = girdle[i], b = girdle[i + 1], t = (f - a.f) / (b.f - a.f);
      return Object.fromEntries(['l', 'r'].map(s => [s, a.shoulders[s] + (b.shoulders[s] - a.shoulders[s]) * t]));
    }, keys };
});
