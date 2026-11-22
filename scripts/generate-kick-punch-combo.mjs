/** Back MK+HP: right middle kick on a planted support foot → lunging body hook. */
import { readFile } from 'node:fs/promises';
import { generateKick } from './kicks/generate.mjs';
import { toAbsolute } from './kicks/rig.mjs';
const data = JSON.parse(await readFile(new URL('../src/data/poses.json', import.meta.url), 'utf8'));
await generateKick(G => {
  const L0 = G.leftFoot[0], R0 = G.rightFoot[0], L1 = L0 + 15;
  const ground = (x, y = 0) => ({ foot: [x, y], knee: 1, space: 'ground' });
  const abs = name => toAbsolute(data.poses[name]);
  // The left support foot never leaves its guard position during the kick.
  const kick = (f, name, hip) => ({ f, ...abs(name), hip, left: ground(L0) });
  // The standing heavy punch, carried to body height: the whole arm and the
  // torso tilt down together, the hook shape itself stays as authored.
  const hook = (f, name, hip, left, tilt = 1) => {
    const p = abs(name), arm = 52 * tilt, lean = 20 * tilt;
    return { f, ...p, hip, torso: p.torso + lean, head: p.head + lean * .5,
      arms: { ...p.arms, l: [p.arms.l[0] + arm, p.arms.l[1] + arm] }, left, right: ground(R0) };
  };
  const keys = [
    { f: 0, ...G, left: ground(L0), right: ground(R0) },
    // The rear heel peels off the floor before the knee drives through.
    { f: 3, hip: [0, -47.6], left: ground(L0), right: ground(R0 + 4, -5) },
    kick(8, 'standing_mk_pass', [0, -48]),
    kick(15, 'standing_mk_anticipate', [-1.5, -46.4]),
    kick(17, 'standing_mk', [-1.5, -46]),
    kick(19, 'standing_mk', [-1.5, -46]),
    kick(21, 'standing_mk_follow', [0.5, -46.3]),
    kick(23, 'standing_mk_return', [1, -47]),
    // The kicking foot sets down behind in its guard position.
    { f: 25, hip: [1.8, -46.8], left: ground(L0), right: ground(R0 + 3, -3) },
    { ...kick(26, 'standing_mk_repass', [2, -46.6]), right: ground(R0) },
    // Step in with the lead foot while the hook winds up.
    hook(28, 'standing_hp_anticipate', [5, -46.4], ground((L0 + L1) / 2, -4), .4),
    hook(30, 'standing_hp', [11, -44.6], ground(L1)),
    hook(32, 'standing_hp', [11.5, -44.4], ground(L1)),
    hook(36, 'standing_hp_follow', [10, -44.8], ground(L1), .8),
    hook(40, 'standing_hp_return', [6, -46], ground(L1), .3),
    // Lead foot steps back into the guard.
    hook(43, 'standing_hp_return', [2, -47], ground((L0 + L1) / 2, -3), 0),
    { f: 46, ...G, left: ground(L0), right: ground(R0) },
  ];
  return { id: 'kick_punch_combo', button: 'HP', buttons: ['MK', 'HP'], direction: 4, duration: 47,
    frame: { startup: 17, active: 16, recovery: 14 }, kickFoot: 'rightFoot',
    // Values of standing_mk, without pushback so the hook still reaches.
    hit: { damage: 65, hitLevel: 'MID', hitstun: 25, blockstun: 18, pushbackHit: 0, pushbackBlock: 0, hitstop: 11 },
    strikes: [
      { from: 17, to: 19, joint: 'rightFoot', group: 'kick' },
      // Values of standing_hp at body height; the finisher pushes back like the other combos.
      { from: 30, to: 32, joint: 'leftHand', group: 'punch', hit: { damage: 85, hitLevel: 'MID', hitstun: 30, blockstun: 21, hitstop: 10, pushbackHit: 5632, pushbackBlock: 4096 } },
    ],
    // Authored body turn for the hook (standing_hp itself has none).
    turn: f => {
      const track = [[0, 0], [26, 0], [28, .15], [30, 1], [32, 1], [36, .85], [40, .3], [46, 0]];
      const i = track.findIndex((_, i) => i + 1 < track.length && f <= track[i + 1][0]);
      const [a, b] = [track[i], track[i + 1]], t = (f - a[0]) / (b[0] - a[0]);
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
