/** Right middle/high → left middle/high, with raised knee chambers → medium punch. */
import { readFile } from 'node:fs/promises';
import { generateKick } from './kicks/generate.mjs';
import { toAbsolute } from './kicks/rig.mjs';
const data = JSON.parse(await readFile(new URL('../src/data/poses.json', import.meta.url), 'utf8'));
await generateKick(G => {
  const ground = x => ({ foot: [x, 0], knee: 1, space: 'ground' });
  const pose = (f, name, support = 'left') => ({ f, ...toAbsolute(data.poses[name]), hip: [0, -49], [support]: ground(support === 'left' ? 10 : -4) });
  const home = f => ({ f, ...G, left: ground(G.leftFoot[0]), right: ground(G.rightFoot[0]) });
  const high = (f, side) => ({ ...pose(f, side === 'right' ? 'standing_rhk' : 'standing_hk', side === 'right' ? 'left' : 'right'), torso: -86, head: -81, [side]: { thigh: -43, shin: -38 } });
  const punch = (f, name) => ({ ...pose(f, name), hip: [4, -47], left: ground(G.leftFoot[0]), right: ground(-4) });
  const keys = [home(0), pose(8, 'standing_mk_pass'), pose(15, 'standing_mk_anticipate'),
    pose(17, 'standing_mk'), pose(19, 'standing_mk'),
    // Only fold the shin; the kicking knee remains raised throughout each pair.
    pose(24, 'standing_mk_anticipate'), pose(26, 'standing_rhk_anticipate'), high(29, 'right'), high(31, 'right'),
    pose(35, 'standing_rhk_return'),
    { ...home(40), hip: [0, -47], left: ground(10), right: ground(-4) },
    pose(46, 'standing_lmk_anticipate', 'right'), pose(49, 'standing_lmk', 'right'), pose(51, 'standing_lmk', 'right'),
    pose(56, 'standing_lmk_anticipate', 'right'), pose(58, 'standing_hk_anticipate', 'right'), high(61, 'left'), high(63, 'left'),
    pose(67, 'standing_hk_return', 'right'),
    punch(73, 'standing_mp_anticipate'), punch(80, 'standing_mp'), punch(82, 'standing_mp'),
    punch(86, 'standing_mp_follow'), punch(91, 'standing_mp_return'), home(96)];
  return { id: 'middle_high_punch_combo', button: 'HK', buttons: ['HK', 'RHK'], direction: 6, duration: 97,
    frame: { startup: 17, active: 66, recovery: 14 }, kickFoot: 'rightFoot',
    hit: { damage: 65, hitLevel: 'MID', hitstun: 30, blockstun: 18, pushbackHit: 0, pushbackBlock: 0, hitstop: 9 },
    strikes: [
      { from: 17, to: 19, joint: 'rightFoot', group: 'rightMiddle' },
      { from: 29, to: 31, joint: 'rightFoot', group: 'rightHigh', hit: { damage: 95, hitLevel: 'HIGH', hitstun: 35 } },
      { from: 49, to: 51, joint: 'leftFoot', group: 'leftMiddle' },
      { from: 61, to: 63, joint: 'leftFoot', group: 'leftHigh', hit: { damage: 95, hitLevel: 'HIGH', hitstun: 35 } },
      { from: 80, to: 82, joint: 'leftHand', group: 'punch', hit: { damage: 50, pushbackHit: 5632, pushbackBlock: 4096 } },
    ],
    // Keep the standing medium punch's authored body turn and guard return.
    turn: f => {
      const track = [[0, 0], [67, 0], [73, .15], [80, 1], [82, 1], [86, .85], [91, .15], [96, 0]];
      const i = track.findIndex((_, i) => i + 1 < track.length && f <= track[i + 1][0]);
      const [a, b] = [track[i], track[i + 1]], t = (f - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * t;
    },
    shoulders: (_, f) => {
      const i = Math.max(0, keys.findIndex((_, i) => i + 1 < keys.length && f <= keys[i + 1].f));
      const a = keys[i], b = keys[i + 1], t = (f - a.f) / (b.f - a.f);
      return Object.fromEntries(['l', 'r'].map(s => [s, a.shoulders[s] + (b.shoulders[s] - a.shoulders[s]) * t]));
    }, keys };
});
