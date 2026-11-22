/** Forward MP+RHK: medium jab → turn back to guard → right high kick. */
import { readFile } from 'node:fs/promises';
import { generateKick } from './kicks/generate.mjs';
import { toAbsolute } from './kicks/rig.mjs';
const data = JSON.parse(await readFile(new URL('../src/data/poses.json', import.meta.url), 'utf8'));
await generateKick(G => {
  const L0 = G.leftFoot[0], R0 = G.rightFoot[0];
  const ground = (x, y = 0) => ({ foot: [x, y], knee: 1, space: 'ground' });
  const abs = name => toAbsolute(data.poses[name]);
  // Jab and guard transition on both planted feet.
  const planted = (f, source, hip) => ({ f, ...source, hip, left: ground(L0), right: ground(R0) });
  // Kick: the left foot stays exactly where it stood in the guard; the hip
  // pushes forward over it so the high kick covers the jab's reach.
  const kick = (f, name, hip) => ({ f, ...abs(name), hip, left: ground(L0) });
  // A body jab: the standing medium punch, arm a few degrees lower, so its
  // MID strike also meets a crouching guard.
  const jab = (f, name, hip) => {
    const p = abs(name);
    return planted(f, { ...p, arms: { ...p.arms, l: [p.arms.l[0] + 5, p.arms.l[1] + 5] } }, hip);
  };
  const keys = [
    planted(0, G, G.hip),
    jab(5, 'standing_mp_anticipate', [-1.5, -46]),
    jab(8, 'standing_mp', [1.5, -44.5]),
    jab(10, 'standing_mp', [1.5, -44.5]),
    // Body turns back towards 0 while the jab retracts into the guard.
    planted(12, abs('standing_mp_return'), [1.5, -46.2]),
    // Guard transition: the rear heel lifts, then the knee passes forward.
    { ...planted(14, G, [2.2, -47]), right: ground(R0 + 5, -6) },
    { ...planted(16, G, [3.5, -47.8]), right: abs('standing_rhk_pass').right },
    kick(18, 'standing_rhk_anticipate', [7.5, -48.4]),
    kick(20, 'standing_rhk', [12, -48.6]),
    kick(22, 'standing_rhk', [12.5, -48.6]),
    kick(24, 'standing_rhk_follow', [10.5, -48.4]),
    kick(26, 'standing_rhk_return', [6.5, -48]),
    kick(30, 'standing_rhk_repass', [2, -47.6]),
    planted(33, G, G.hip),
  ];
  return { id: 'punch_kick_combo', button: 'RHK', buttons: ['MP', 'RHK'], direction: 6, duration: 34,
    frame: { startup: 8, active: 15, recovery: 11 }, kickFoot: 'rightFoot',
    // Jab values of standing_mp, without pushback so the kick still reaches.
    hit: { damage: 55, hitLevel: 'MID', hitstun: 23, blockstun: 16, pushbackHit: 0, pushbackBlock: 0, hitstop: 10 },
    strikes: [
      { from: 8, to: 10, joint: 'leftHand', group: 'punch' },
      // Values of standing_rhk; the finisher pushes back like the other combos.
      { from: 20, to: 22, joint: 'rightFoot', group: 'kick', hit: { damage: 95, hitLevel: 'HIGH', hitstun: 33, blockstun: 23, hitstop: 11, pushbackHit: 5632, pushbackBlock: 4096 } },
    ],
    // Authored body turn of the standing medium punch, back to 0 before the kick.
    turn: f => {
      const track = [[0, 0], [5, .15], [8, 1], [10, 1], [12, .4], [14, 0], [33, 0]];
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
