/**
 * Revenge combo F: quarter circle forward (down, down-forward, forward) + LK with a
 * full Revenge bar. The "kick ladder": seven kicks and no punch, climbing from
 * the shins to the head and ending in a heavy push kick.
 *
 *   right low, left low, right middle, left middle, right high, left high, push kick
 *
 * What sets it apart from the punch-led Revenge combo (`revenge_combo`):
 *  - it opens LOW (crouch guard) where the classic opener is HIGH, so the
 *    opponent has to read a different guard,
 *  - the legs alternate every hit: each kick lands back next to the support foot
 *    before the other leg chambers, so the body works on the spot like a switch
 *    kicker and the fighter only creeps forward over the whole ladder,
 *  - the rhythm is steady (12 frames per kick) with a slow, deliberate wind-up
 *    for the finisher: a straight right push kick at hip height, torso leaning
 *    back, with the largest pushback and the knockdown.
 *
 * Feet never slide: a planted foot is pinned in world coordinates (the ground
 * space of the rig); every kick lands on a spot that moves with the origin.
 */
import { readFile } from 'node:fs/promises';
import { generateKick } from './kicks/generate.mjs';
import { toAbsolute } from './kicks/rig.mjs';
const data = JSON.parse(await readFile(new URL('../src/data/poses.json', import.meta.url), 'utf8'));
await generateKick(G => {
  const abs = name => toAbsolute(data.poses[name]);
  const ground = (x, y = 0) => ({ foot: [x, y], knee: 1, space: 'ground' });
  // The origin creeps forward over the ladder; the feet land on spots that travel with it.
  const ADV = { frames: 72, distance: 24 };
  const adv = f => { const t = Math.min(1, f / ADV.frames); return ADV.distance * t * t * (3 - 2 * t); };
  const hipAt = (f, x, y) => [x - adv(f), y];
  // World x of both feet (frame-0 coordinates); updated whenever a foot lands.
  const feet = { left: G.leftFoot[0], right: G.rightFoot[0] };
  // The left foot lands exactly on its guard spot, so the final guard pose needs no step.
  const LAND = { left: G.leftFoot[0], right: 0 };
  const home = f => ({ f, hip: hipAt(f, (feet.left + feet.right) / 2 + 2.5, -47), torso: G.torso, head: G.head, arms: G.arms, shoulders: G.shoulders,
    left: ground(feet.left), right: ground(feet.right) });
  const STEP = 12;
  const first = 10, last = first + 5 * STEP + 16;
  const ladder = [
    { side: 'right', level: 'low', pose: 'standing_rlk', group: 'lowRight', at: first,
      hit: { damage: 35, hitLevel: 'LOW', hitstun: 15, blockstun: 12, hitstop: 7 } },
    { side: 'left', level: 'low', pose: 'standing_lk', group: 'lowLeft', at: first + STEP,
      hit: { damage: 35, hitLevel: 'LOW', hitstun: 15, blockstun: 12, hitstop: 7 } },
    { side: 'right', level: 'mid', pose: 'standing_mk', group: 'midRight', at: first + 2 * STEP,
      hit: { damage: 55, hitLevel: 'MID', hitstun: 15, blockstun: 16, hitstop: 8 } },
    { side: 'left', level: 'mid', pose: 'standing_lmk', group: 'midLeft', at: first + 3 * STEP,
      hit: { damage: 60, hitLevel: 'MID', hitstun: 15, blockstun: 17, hitstop: 9 } },
    { side: 'right', level: 'high', pose: 'standing_rhk', group: 'highRight', at: first + 4 * STEP,
      hit: { damage: 80, hitLevel: 'HIGH', hitstun: 16, blockstun: 22, hitstop: 10 } },
    { side: 'left', level: 'high', pose: 'standing_hk', group: 'highLeft', at: first + 5 * STEP,
      hit: { damage: 90, hitLevel: 'HIGH', hitstun: 18, blockstun: 23, hitstop: 10 } },
    // Knockdown via rules.hitStrength.overrides["revenge_combo_f:thrust"]; only the finisher pushes.
    { side: 'right', level: 'thrust', pose: 'standing_mk', group: 'thrust', at: last,
      hit: { damage: 135, hitLevel: 'MID', hitstun: 30, blockstun: 22, hitstop: 14, pushbackHit: 6144, pushbackBlock: 4096 } },
  ];
  // The first kicking foot lifts in place before the leg chambers (no sliding over the floor).
  const keys = [{ f: 0, ...G, left: ground(feet.left), right: ground(feet.right) }, { f: 3, right: ground(feet.right + 2, -5) }];
  for (const k of ladder) {
    const o = k.side === 'left' ? 'right' : 'left', S = k.at;
    // Weight over the support foot: a little behind a lead foot, forward over a rear one.
    const hipX = feet[o] + (o === 'left' ? 2 : 18);
    const pose = (f, name, extra = {}) => ({ f, ...abs(name), hip: hipAt(f, hipX, -49), [o]: ground(feet[o]), ...extra });
    const shaped = f => {
      if (k.level === 'high') return { ...pose(f, k.pose), torso: -86, head: -81, [k.side]: { thigh: -38, shin: -28 } };
      // Straight leg at hip height, the torso leaning away from it.
      if (k.level === 'thrust') return { ...pose(f, k.pose), torso: -98, head: -88, [k.side]: { thigh: -6, shin: -3 } };
      return pose(f, k.pose);
    };
    if (k.level === 'thrust') keys.push(pose(S - 8, 'standing_mk_pass'));
    keys.push(pose(S - 4, `${k.pose}_anticipate`), shaped(S), shaped(S + 2));
    keys.push(pose(S + (k.level === 'thrust' ? 6 : 4), `${k.pose}_return`));
    if (k.level === 'thrust') keys.push(pose(S + 10, `${k.pose}_return`, { torso: G.torso + 4 }));
    // The kicking foot lands next to the support foot (the finisher on its guard spot), coming down from above.
    const landing = S + (k.level === 'thrust' ? 14 : 6);
    feet[k.side] = (k.level === 'thrust' ? G.rightFoot[0] : LAND[k.side]) + adv(landing);
    keys.push({ ...keys.at(-1), f: landing - 1, [k.side]: ground(feet[k.side], -4) });
    keys.push(k.level === 'thrust' ? { ...home(landing), f: landing } : home(landing));
  }
  keys.push({ f: last + 18, ...G, left: ground(feet.left), right: ground(feet.right) });
  const strikes = ladder.map(k => ({ from: k.at, to: k.at + 2, joint: `${k.side}Foot`, group: k.group, hit: k.hit }));
  return { id: 'revenge_combo_f', button: 'LK', motion: '236+K', duration: last + 19, priority: 30,
    advance: ADV,
    resource: 'revenge', standingHitstun: true,
    frame: { startup: first, active: last + 2 - first + 1, recovery: last + 19 - (last + 2 + 1) },
    kickFoot: 'rightFoot',
    // Base values: no pushback, so every kick still reaches after the previous one.
    hit: { damage: 35, hitLevel: 'LOW', hitstun: 15, blockstun: 12, pushbackHit: 0, pushbackBlock: 0, hitstop: 7 },
    strikes,
    hurtJoint: f => strikes.reduce((best, s) => Math.min(Math.abs(f - s.from), Math.abs(f - s.to)) < Math.min(Math.abs(f - best.from), Math.abs(f - best.to)) ? s : best).joint,
    shoulders: (_, f) => {
      const girdle = keys.filter(key => key.shoulders);
      const i = Math.max(0, girdle.findIndex((_, i) => i + 1 < girdle.length && f <= girdle[i + 1].f));
      const a = girdle[i], b = girdle[i + 1], t = (f - a.f) / (b.f - a.f);
      return Object.fromEntries(['l', 'r'].map(s => [s, a.shoulders[s] + (b.shoulders[s] - a.shoulders[s]) * t]));
    }, keys };
});
