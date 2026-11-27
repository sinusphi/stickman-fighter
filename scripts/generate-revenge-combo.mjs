/**
 * Hold down, add forward and keep both (down-forward held: motion 23) + LP with a
 * full Revenge bar: jab → hook → left middle → left
 * high → right middle → right high → heavy hook finisher (seven hits).
 *
 * Footwork, so no support foot ever slides (ground positions are in the
 * coordinates of frame 0; the move advances STEP over the jab and the hook):
 *  - step-in jab: the lead (left) foot steps forward and lands with the jab,
 *  - hook: the rear (right) foot follows with a pivot step under the hip,
 *  - left middle and left high stand on that right foot; the kicking knee stays
 *    raised between both, only the shin folds,
 *  - the left foot sets down on its guard spot in front, the weight moves over
 *    it and the right knee drives through for the right middle and right high,
 *  - the right foot lands back on its guard spot and the finisher lunges
 *    forward over the bent lead knee on both planted feet.
 */
import { readFile } from 'node:fs/promises';
import { generateKick } from './kicks/generate.mjs';
import { toAbsolute } from './kicks/rig.mjs';
const data = JSON.parse(await readFile(new URL('../src/data/poses.json', import.meta.url), 'utf8'));
await generateKick(G => {
  const L0 = G.leftFoot[0], R0 = G.rightFoot[0];
  // Step-in over jab and hook (rig units): without it a jab that lands at its
  // full reach would leave the following strikes short.
  const STEP = 18, STEP_FRAMES = 16;
  // Feet after the step-in: lead foot, rear foot under the hip for the left
  // kicks, rear foot back on its guard spot for the finisher.
  const L = L0 + STEP, R1 = -5 + STEP, R = R0 + STEP;
  const ground = (x, y = 0) => ({ foot: [x, y], knee: 1, space: 'ground' });
  const abs = name => toAbsolute(data.poses[name]);
  // Punches on two planted feet.
  const planted = (f, name, hip, right = ground(R0), left = ground(L)) => ({ f, ...abs(name), hip, left, right });
  // The jab is aimed at chin height of a crouching opponent (upper chest of a
  // standing one): arm and torso a little lower than the standing light punch.
  const JAB_DROP = 28, JAB_LEAN = 6;
  const jab = (f, name, hip, left) => {
    const p = planted(f, name, hip, ground(R0), left);
    return { ...p, torso: p.torso + JAB_LEAN, arms: { ...p.arms, l: [p.arms.l[0] + JAB_DROP, p.arms.l[1] + JAB_DROP + 12] } };
  };
  // The hook goes to the body, a little lower and longer than the standing medium punch.
  const body = (f, name, hip, right) => {
    const p = planted(f, name, hip, right);
    return { ...p, arms: { ...p.arms, l: [p.arms.l[0] - 14, p.arms.l[1] + 10] } };
  };
  // Kicks: the authored kick pose on one planted support foot.
  const onRight = (f, name, hip) => ({ f, ...abs(name), hip, right: ground(R1) });
  const onLeft = (f, name, hip) => ({ f, ...abs(name), hip, left: ground(L) });
  // High kick straight out of the raised knee (as in generate-middle-high-punch),
  // a little more extended so it reaches as far as the middle kick.
  const high = (f, side, hip) => ({ ...(side === 'left' ? onRight(f, 'standing_hk', hip) : onLeft(f, 'standing_rhk', hip)),
    torso: -86, head: -81, [side]: { thigh: -38, shin: -28 } });
  // The finisher: the standing heavy punch, the torso leaning into it.
  const hook = (f, name, hip, lean = 1) => {
    const p = abs(name);
    return { f, ...p, hip, torso: p.torso + 6 * lean, left: ground(L), right: ground(R) };
  };
  const keys = [
    { f: 0, ...G, left: ground(L0), right: ground(R0) },
    // 1. Step-in jab (lead hand): the lead foot lands with the punch.
    jab(3, 'standing_lp_anticipate', [-1, -47], ground((L0 + L) / 2, -6)),
    jab(6, 'standing_lp', [-4, -46.6], ground(L)),
    jab(7, 'standing_lp', [-3.8, -46.6], ground(L)),
    // 2. Hook: the jab hand pulls back into the wind-up while the rear foot
    //    follows with a pivot step and lands with the hook.
    planted(10, 'standing_mp_anticipate', [0, -46.8], ground((R0 + R1) / 2, -6)),
    body(14, 'standing_mp', [10, -45.2], ground(R1)),
    body(16, 'standing_mp', [10.2, -45.2], ground(R1)),
    // 3. Weight back over the right foot, the left knee comes up.
    { ...planted(19, 'standing_mp_return', [-1, -47.4], ground(R1)), left: ground(L - 3, -9) },
    onRight(21, 'standing_lmk_anticipate', [-2, -48.6]),
    onRight(23, 'standing_lmk', [-2, -49]),
    onRight(25, 'standing_lmk', [-2, -49]),
    // 4. Only the shin folds, the knee stays up for the high kick.
    onRight(28, 'standing_lmk_anticipate', [-1.5, -48.8]),
    onRight(29, 'standing_hk_anticipate', [-1, -48.8]),
    high(32, 'left', [0, -49]),
    high(34, 'left', [0, -49]),
    // 5. The left foot sets down in front, the weight moves over it, the right
    //    heel peels off and the right knee drives through.
    onRight(37, 'standing_hk_return', [-1, -48.4]),
    planted(39, 'standing_mp_return', [2, -47.6], ground(R1)),
    onLeft(41, 'standing_mk_pass', [3, -48]),
    onLeft(42, 'standing_mk_anticipate', [2, -48.4]),
    onLeft(44, 'standing_mk', [3, -49]),
    onLeft(46, 'standing_mk', [3, -49]),
    // 6. Shin folds again, right high kick from the raised knee.
    onLeft(49, 'standing_mk_anticipate', [3, -48.8]),
    onLeft(50, 'standing_rhk_anticipate', [3, -48.8]),
    high(53, 'right', [4, -49]),
    high(55, 'right', [4, -49]),
    // 7. The right foot lands back on its guard spot, then the heavy hook
    //    lunges forward over the bent lead knee on both planted feet.
    onLeft(58, 'standing_rhk_return', [1, -48.2]),
    // The foot comes down from above its spot, it never drags over the floor.
    { ...onLeft(60, 'standing_hp_anticipate', [0, -47.6]), right: ground(R + 2, -7) },
    hook(61, 'standing_hp_anticipate', [-.5, -47.2], .3),
    hook(64, 'standing_hp', [6, -45]),
    hook(66, 'standing_hp', [6.4, -44.9]),
    hook(69, 'standing_hp_follow', [4.5, -45.4], .8),
    hook(72, 'standing_hp_return', [2, -46.6], .3),
    { f: 76, ...G, left: ground(L), right: ground(R) },
  ];
  const strikes = [
    { from: 6, to: 7, joint: 'leftHand', group: 'jab', hit: { damage: 40, hitLevel: 'HIGH', hitstun: 12, blockstun: 11, hitstop: 7 } },
    { from: 14, to: 16, joint: 'leftHand', group: 'hook', hit: { damage: 60, hitLevel: 'MID', hitstun: 13, blockstun: 16, hitstop: 8 } },
    { from: 23, to: 25, joint: 'leftFoot', group: 'leftMiddle', hit: { damage: 65, hitLevel: 'MID', hitstun: 13, blockstun: 18, hitstop: 9 } },
    { from: 32, to: 34, joint: 'leftFoot', group: 'leftHigh', hit: { damage: 80, hitLevel: 'HIGH', hitstun: 16, blockstun: 23, hitstop: 10 } },
    { from: 44, to: 46, joint: 'rightFoot', group: 'rightMiddle', hit: { damage: 65, hitLevel: 'MID', hitstun: 13, blockstun: 18, hitstop: 9 } },
    { from: 53, to: 55, joint: 'rightFoot', group: 'rightHigh', hit: { damage: 80, hitLevel: 'HIGH', hitstun: 15, blockstun: 23, hitstop: 10 } },
    // Knockdown via rules.hitStrength.overrides["revenge_combo:punch"]; only the finisher pushes.
    { from: 64, to: 66, joint: 'leftHand', group: 'punch', hit: { damage: 110, hitLevel: 'HIGH', hitstun: 30, blockstun: 21, hitstop: 14, pushbackHit: 5632, pushbackBlock: 4096 } },
  ];
  // Body turn of the punches (as authored for standing_mp), square again for the kicks.
  const turnTrack = [[0, 0], [7, 0], [10, .15], [14, 1], [16, 1], [19, .45], [21, 0], [58, 0], [61, .15], [64, 1], [66, 1], [69, .85], [72, .3], [76, 0]];
  return { id: 'revenge_combo', button: 'LP', motion: '23+P', duration: 77, priority: 30,
    advance: { frames: STEP_FRAMES, distance: STEP },
    resource: 'revenge', standingHitstun: true,
    frame: { startup: 6, active: 61, recovery: 10 }, kickFoot: 'leftFoot',
    // Base values: no pushback, so every strike still reaches after the previous one.
    hit: { damage: 40, hitLevel: 'HIGH', hitstun: 12, blockstun: 11, pushbackHit: 0, pushbackBlock: 0, hitstop: 7 },
    strikes,
    // Between strikes the limb that just struck (or strikes next) counts as extended.
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
