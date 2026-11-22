/**
 * Throws: the thrower's clips (attempt with whiff, two executions, clash) and
 * the thrown fighter's clips, baked per frame with the kick rig (scripts/kicks),
 * plus the five throw moves including the victim's per-frame path table.
 *
 *   node scripts/generate-throws.mjs          write poses.json and moves.json
 *   node scripts/generate-throws.mjs --check  fail if either file is stale
 *
 * Coordinates: rig units, +x towards the opponent (thrower's view), +y down,
 * floor at 0. Up to its release frame the victim hangs with its neck at the
 * midpoint of the thrower's hands as the production renderer samples them;
 * afterwards its hip follows a curved flight onto the floor. The whole-body
 * rotation is baked into the absolute bone angles (no rotation track), so the
 * last frame equals the knockdown pose exactly and nothing spins on hand-over.
 */
import { createServer } from 'vite';
import { isDeepStrictEqual } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { PYTHON } from './python.mjs';
import { bake, toAbsolute, toAnglePose, legFK, legIK, add, polar, deg } from './kicks/rig.mjs';

const check = process.argv.includes('--check');
const posesPath = new URL('../src/data/poses.json', import.meta.url);
const movesPath = new URL('../src/data/moves.json', import.meta.url);
const poses = JSON.parse(await readFile(posesPath, 'utf8'));
const moves = JSON.parse(await readFile(movesPath, 'utf8'));
const bodies = JSON.parse(await readFile(new URL('../src/data/bodies.json', import.meta.url), 'utf8'));

// ----------------------------------------------------------------- tuning ----
/** Grab reach from the front edge of the standing pushbox, unscaled subpixels (29 rig px ≈ 36 px on screen). */
export const GRAB_RANGE = 29 * 256;
const ATTEMPT = { startup: 4, active: 1, recovery: 22 };
const THROWS = {
  forward: { id: 'throw_forward', direction: 6, damage: 110, duration: 40, release: 12, impact: 20 },
  back: { id: 'throw_back', direction: 4, damage: 130, duration: 46, release: 16, impact: 26 },
};
const BREAK = { id: 'throw_break', duration: 14, push: 14 * 256 };

// ------------------------------------------------------------- the guard ----
const guardPose = poses.poses.guard;
const guard = toAbsolute(guardPose);
const feet = { left: legFK(guard.left), right: legFK(guard.right) };
const floorShift = Math.max(feet.left[1], feet.right[1]) + guard.hip[1];
guard.hip = [guard.hip[0], guard.hip[1] - floorShift];
guard.leftFoot = add(guard.hip, feet.left); guard.rightFoot = add(guard.hip, feet.right);
guard.leftFoot[1] = 0; guard.rightFoot[1] = 0;
const exactGuard = { ...structuredClone(guardPose), root: [guard.hip[0], guard.hip[1]] };

// ------------------------------------------------------------- arm IK ----
const UPPER = 18, FORE = 20, NECK = 30, SHOULDER = 5;
/** The victim's neck sits just in front of the midpoint of the thrower's hands. */
export const NECK_OFFSET = [2, 0];
const shoulderAt = (hip, torso, relative) => add(add(hip, polar(torso, NECK)), polar(torso + relative, SHOULDER));
function armIK(shoulder, target, bend = 1) {
  const dx = target[0] - shoulder[0], dy = target[1] - shoulder[1];
  const distance = Math.max(Math.abs(UPPER - FORE) + 0.01, Math.min(Math.hypot(dx, dy), (UPPER + FORE) * 0.999));
  const angle = deg(Math.atan2(dy, dx));
  const open = deg(Math.acos((UPPER * UPPER + distance * distance - FORE * FORE) / (2 * UPPER * distance)));
  const upper = angle + bend * open, elbow = add(shoulder, polar(upper, UPPER));
  return [upper, deg(Math.atan2(target[1] - elbow[1], target[0] - elbow[0]))];
}
/** Thrower key: hip, torso and hand targets (left, right) solved to absolute arm angles. */
const reach = (f, hip, torso, left, right, extra = {}) => ({
  f, hip, torso, ...extra,
  arms: { l: armIK(shoulderAt(hip, torso, guard.shoulders.l), left), r: armIK(shoulderAt(hip, torso, guard.shoulders.r), right) },
});
const guardKey = f => ({ f, hip: guard.hip, torso: guard.torso, head: guard.head, arms: guard.arms });

// The grab pose is shared: attempt frame `startup` and the first frame of every execution and of the clash.
const GRAB = { hip: [4, guard.hip[1] - 0.3], torso: -66, left: [35, -79], right: [33, -75] };
const grabKey = f => reach(f, GRAB.hip, GRAB.torso, GRAB.left, GRAB.right);

const throwerClips = {
  // Attempt: reach in, close the hands on air, stumble and recover (whiff).
  attempt: { duration: ATTEMPT.startup + ATTEMPT.active + ATTEMPT.recovery, keys: [
    guardKey(0),
    reach(2, [1.5, -43.6], -70, [26, -76], [24, -72]),
    grabKey(ATTEMPT.startup),
    reach(7, [6, -42.4], -60, [38, -70], [37, -67]),
    reach(12, [5, -41], -57, [30, -50], [28, -47]),
    { ...guardKey(20), hip: [2, -42.6], torso: -68 },
    guardKey(26),
  ] },
  // Hip throw: pull in, load onto the hip, lever the opponent over and slam it down in front.
  forward: { duration: THROWS.forward.duration, keys: [
    grabKey(0),
    reach(3, [6, -42], -68, [28, -72], [26, -69]),
    reach(7, [8, -39.5], -56, [24, -84], [22, -80]),
    reach(10, [8.5, -38.5], -49, [30, -88], [28, -84]),
    reach(THROWS.forward.release, [9, -37.5], -43, [40, -66], [38, -62]),
    reach(16, [9.5, -35.5], -40, [46, -47], [44, -43]),
    reach(THROWS.forward.impact, [9, -35], -40, [47, -38], [45, -34]),
    reach(26, [7, -37], -45, [36, -48], [34, -45]),
    { ...guardKey(33), hip: [3, -41.8], torso: -64 },
    guardKey(39),
  ] },
  // Shoulder throw: dip, heave the opponent up over head and shoulder and hurl it down behind.
  back: { duration: THROWS.back.duration, keys: [
    grabKey(0),
    reach(4, [3, -39.5], -80, [29, -66], [27, -62]),
    reach(9, [1, -42], -92, [23, -96], [21, -92]),
    reach(13, [-1, -43.5], -102, [9, -111], [7, -107]),
    reach(THROWS.back.release, [-2, -43.5], -110, [-10, -103], [-12, -99]),
    reach(20, [-2, -42], -114, [-24, -84], [-26, -80]),
    reach(THROWS.back.impact, [-1, -40], -104, [-22, -64], [-24, -60]),
    reach(33, [0, -41.5], -88, [6, -58], [4, -54]),
    { ...guardKey(40), hip: [0.5, -42.6], torso: -75 },
    guardKey(45),
  ] },
  // Clash: hands knocked apart, both lean back and recover.
  clash: { duration: BREAK.duration, keys: [
    grabKey(0),
    reach(3, [-2, -43], -84, [30, -84], [18, -50]),
    reach(7, [-3, -42.6], -80, [22, -76], [16, -52]),
    guardKey(13),
  ] },
};

// ------------------------------------------------------ victim shapes ----
// Canonical absolute angles (victim facing +x, i.e. towards the thrower).
const knockdown = toAbsolute(poses.poses.Knockdown);
const shape = (torso, head, l, r, left, right, shoulders = guard.shoulders) => ({ torso, head, arms: { l, r }, left: { thigh: left[0], shin: left[1] }, right: { thigh: right[0], shin: right[1] }, shoulders });
const SHAPES = {
  guard: shape(guard.torso, guard.head, guard.arms.l, guard.arms.r, [guard.left.thigh, guard.left.shin], [guard.right.thigh, guard.right.shin]),
  grabbed: shape(-64, -50, [-35, -72], [-6, -42], [84, 100], [100, 116]),
  lifted: shape(-80, -66, [-62, -95], [-30, -62], [74, 104], [96, 124]),
  tuck: shape(-90, -80, [-150, -172], [-122, -142], [22, 86], [36, 102]),
  land: shape(knockdown.torso, knockdown.head, knockdown.arms.l, knockdown.arms.r, [knockdown.left.thigh, knockdown.left.shin], [knockdown.right.thigh, knockdown.right.shin], knockdown.shoulders),
};
/** Mirror image (x → −x): absolute angles α → 180 − α, relative shoulder angles negate. */
const mirror = s => shape(180 - s.torso, 180 - s.head, s.arms.l.map(a => 180 - a), s.arms.r.map(a => 180 - a),
  [180 - s.left.thigh, 180 - s.left.shin], [180 - s.right.thigh, 180 - s.right.shin], { l: -s.shoulders.l, r: -s.shoulders.r });
SHAPES.landMirrored = mirror(SHAPES.land);
const mirroredKnockdown = (() => {
  const a = poses.poses.Knockdown.angles, out = {};
  for (const [joint, value] of Object.entries(a)) out[joint] = joint === 'neck' || joint.endsWith('Knee') ? 180 - value : -value;
  return out;
})();

const VICTIMS = {
  // Pitches head-first over the thrower's hip (clockwise in its own view), lands on the back in front.
  forward: { shapes: [[0, 'guard'], [3, 'grabbed'], [6, 'grabbed'], [THROWS.forward.release, 'tuck'], [THROWS.forward.impact, 'land']],
    spin: [[0, 0], [6, 22], [THROWS.forward.release, 205], [THROWS.forward.impact, 360]], land: 60, arc: 16, final: poses.poses.Knockdown.angles },
  // Heaved up over the head, flips the other way and lands on the back behind the thrower.
  back: { shapes: [[0, 'guard'], [3, 'grabbed'], [8, 'lifted'], [THROWS.back.release, 'tuck'], [THROWS.back.impact, 'landMirrored']],
    spin: [[0, 0], [8, -40], [THROWS.back.release, -250], [THROWS.back.impact, -360]], land: -58, arc: 12, final: mirroredKnockdown },
};

// ------------------------------------------------------------ helpers ----
/** Monotone cubic through keyed values (same scheme as the rig baker). */
function track(keys, f) {
  const i = Math.max(0, keys.findIndex((_, index) => index + 1 < keys.length && f <= keys[index + 1][0]));
  const [t0, a] = keys[i], [t1, b] = keys[i + 1], h = t1 - t0, u = (f - t0) / h, slope = (b - a) / h;
  const tangent = (s0, s1, h0, h1) => s0 * s1 <= 0 ? 0 : (3 * h0 + 3 * h1) / ((2 * h1 + h0) / s0 + (h1 + 2 * h0) / s1);
  const m0 = i > 0 ? tangent((a - keys[i - 1][1]) / (t0 - keys[i - 1][0]), slope, t0 - keys[i - 1][0], h) : 0;
  const m1 = i + 2 < keys.length ? tangent(slope, (keys[i + 2][1] - b) / (keys[i + 2][0] - t1), h, keys[i + 2][0] - t1) : 0;
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * a + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * b + (u3 - u2) * h * m1;
}
const near = (value, reference) => value + 360 * Math.round((reference - value) / 360);
/** Interpolated victim shape plus whole-body rotation (added to every absolute angle). */
function victimState(definition, f) {
  const keyed = definition.shapes.map(([frame, name]) => [frame, SHAPES[name]]);
  const angle = get => {
    let previous;
    const keys = keyed.map(([frame, s]) => { const value = previous === undefined ? get(s) : near(get(s), previous); previous = value; return [frame, value]; });
    return track(keys, f);
  };
  const spin = track(definition.spin, f);
  const absolute = get => angle(get) + spin;
  return {
    torso: absolute(s => s.torso), head: absolute(s => s.head),
    arms: { l: [absolute(s => s.arms.l[0]), absolute(s => s.arms.l[1])], r: [absolute(s => s.arms.r[0]), absolute(s => s.arms.r[1])] },
    left: { thigh: absolute(s => s.left.thigh), shin: absolute(s => s.left.shin) },
    right: { thigh: absolute(s => s.right.thigh), shin: absolute(s => s.right.shin) },
    shoulders: { l: angle(s => s.shoulders.l), r: angle(s => s.shoulders.r) },
    hip: [0, 0],
  };
}

function framesOf(id, duration, keys, first) {
  const baked = bake({ id, duration, keys }, guard);
  const result = {};
  baked.forEach(({ state }, frame) => {
    result[`${id}_${frame}`] = frame === duration - 1 ? exactGuard : frame === 0 && first ? structuredClone(first) : toAnglePose(state, guard.shoulders);
  });
  return result;
}
const clip = (id, duration, extra = {}) => ({
  durationFrames: duration, loop: false, grounded: false, ...extra, interpolation: 'angles',
  keyframes: Array.from({ length: duration }, (_, frame) => ({ frame, pose: `${id}_${frame}`, easing: 'linear' })),
});

// ------------------------------------------------------------- baking ----
const newPoses = {}, animations = {};
const attemptPoses = {};
for (const t of Object.values(THROWS)) {
  Object.assign(attemptPoses, framesOf(t.id, throwerClips.attempt.duration, throwerClips.attempt.keys));
}
// Attempt frame 0 is the exact guard as well.
for (const t of Object.values(THROWS)) attemptPoses[`${t.id}_0`] = exactGuard;
const grabPose = attemptPoses[`throw_forward_${ATTEMPT.startup}`];
Object.assign(newPoses, attemptPoses);
for (const t of Object.values(THROWS)) animations[t.id] = clip(t.id, throwerClips.attempt.duration, { clampFloor: true });
for (const [name, t] of Object.entries(THROWS)) {
  const id = `${t.id}_exec`;
  Object.assign(newPoses, framesOf(id, t.duration, throwerClips[name].keys, grabPose));
  animations[id] = clip(id, t.duration, { clampFloor: true });
}
Object.assign(newPoses, framesOf(BREAK.id, BREAK.duration, throwerClips.clash.keys, grabPose));
animations[BREAK.id] = clip(BREAK.id, BREAK.duration, { clampFloor: true });

const server = await createServer({ server: { middlewareMode: true, ws: false, hmr: false, watch: null }, appType: 'custom', logLevel: 'error' });
const paths = {};
try {
  const runtime = await server.ssrLoadModule('/src/render/skeleton.ts');
  const { figureBottom, jointBottom } = await server.ssrLoadModule('/src/render/figure-geometry.ts');
  const { FIGURE_SCALE } = await server.ssrLoadModule('/src/data/figure-scale.ts');
  const rawPoses = await server.ssrLoadModule('/src/data/poses.json');
  Object.assign(rawPoses.default.poses, newPoses);
  Object.assign(runtime.animations, animations);
  const toSim = value => Math.round(value * FIGURE_SCALE * 256);

  for (const [name, t] of Object.entries(THROWS)) {
    const execute = `${t.id}_exec`, victim = `${t.id}_victim`, definition = VICTIMS[name];
    const hips = [], shapes = [];
    for (let f = 0; f <= t.impact; f++) {
      const state = victimState(definition, f);
      let hip = null;
      if (f <= t.release) {
        // Hanging on the thrower's hands; the world torso direction is mirrored (it faces the thrower).
        const pose = runtime.samplePose(execute, f), hands = [(pose.leftHand[0] + pose.rightHand[0]) / 2, (pose.leftHand[1] + pose.rightHand[1]) / 2];
        const torso = 180 - (f === 0 ? guard.torso : state.torso);
        hip = add(add(hands, NECK_OFFSET), polar(torso, -NECK));
        // Pulled down, the knees give way: a foot that would sink below the floor is planted on it.
        if (f > 0) for (const side of ['left', 'right']) {
          const foot = legFK(state[side]);
          if (hip[1] + foot[1] > 0) state[side] = legIK([foot[0], -hip[1]], 1);
        }
      }
      const angles = toAnglePose(state, state.shoulders);
      if (f === 0) angles.angles = structuredClone(guardPose.angles);
      if (f === t.impact) angles.angles = structuredClone(definition.final);
      const relative = runtime.buildPose(angles);
      // Impact: lie on the floor exactly like the knockdown renderer (capsule outline); before: no joint below it.
      shapes.push({ angles, bottom: f === t.impact ? figureBottom(relative) : jointBottom(relative) });
      hips.push(hip);
    }
    // Flight: quadratic curve from the release point onto the floor, accelerating downwards.
    const start = hips[t.release], end = [definition.land, -shapes[t.impact].bottom];
    const control = [(start[0] + end[0]) / 2, Math.min(start[1], end[1]) - definition.arc];
    for (let f = t.release + 1; f <= t.impact; f++) {
      const u = ((f - t.release) / (t.impact - t.release)) ** 1.25;
      hips[f] = [0, 1].map(i => (1 - u) ** 2 * start[i] + 2 * (1 - u) * u * control[i] + u * u * end[i]);
    }
    const victimPoses = {}, path = [];
    hips.forEach((hip, f) => {
      // Never below the floor: lift the whole body by its lowest capsule.
      // The anchor (simulation position) is the floor projection of the lowest joint:
      // y is the height of the body above the floor, the root offset carries the rest.
      const y = Math.min(hip[1], -shapes[f].bottom), anchor = [hip[0], Math.min(0, y + shapes[f].bottom)];
      const root = [0, Math.round((y - anchor[1]) * 1e4) / 1e4];
      victimPoses[`${victim}_${f}`] = { root, angles: shapes[f].angles.angles };
      path.push([toSim(anchor[0]), f === t.impact ? 0 : Math.min(0, toSim(anchor[1]))]);
    });
    Object.assign(newPoses, victimPoses);
    animations[victim] = clip(victim, t.impact + 1, { clampBody: true });
    paths[name] = path;
  }
} finally { await server.close(); }

// -------------------------------------------------------------- moves ----
const standing = bodies.standing;
const frameRange = duration => [{ from: 0, to: duration - 1, hitboxes: [], hurtboxes: structuredClone(standing.hurtboxes), pushbox: structuredClone(standing.pushbox) }];
const base = (id, direction, frame, extra) => ({
  schemaVersion: 1, id, stance: 'standing', button: 'THROW',
  command: { type: 'hold', directions: [direction], buttons: ['THROW'], trigger: 'pressed', priority: 10 },
  animation: id, startup: frame.startup, active: frame.active, recovery: frame.recovery,
  damage: 0, hitLevel: 'MID', hitstun: 0, blockstun: 0, pushbackHit: 0, pushbackBlock: 0, hitstop: 0,
  airHitReaction: 'knockdown', multiHit: false, hitGroups: [{ id: 'throw', maxHitsPerTarget: 1 }],
  cancelWindows: [], combo: { scalingPermille: 1000, juggleCost: 0, juggleLimit: 0 },
  ...extra,
  frameRanges: frameRange(frame.startup + frame.active + frame.recovery),
});
const throwMoves = [];
for (const [name, t] of Object.entries(THROWS)) {
  throwMoves.push(base(t.id, t.direction, ATTEMPT, { hitstop: 6, throw: { phase: 'attempt', range: GRAB_RANGE, execute: `${t.id}_exec` } }));
  throwMoves.push(base(`${t.id}_exec`, t.direction, { startup: t.impact, active: 1, recovery: t.duration - t.impact - 1 },
    { damage: t.damage, hitstop: 12, throw: { phase: 'execute', impactFrame: t.impact, releaseFrame: t.release, victimAnimation: `${t.id}_victim`, path: paths[name] } }));
}
throwMoves.push(base(BREAK.id, 6, { startup: 1, active: 1, recovery: BREAK.duration - 2 }, { pushbackHit: BREAK.push, hitstop: 6, throw: { phase: 'break' } }));
for (const move of throwMoves) {
  const index = moves.findIndex(m => m.id === move.id);
  if (index < 0) moves.push(move); else moves[index] = move;
}

// ---------------------------------------------------------- writing ----
const ids = Object.keys(animations);
const generated = new RegExp(`^(${ids.join('|')})_\\d+$`);
const stale = [];
const updated = structuredClone(poses);
for (const name of Object.keys(updated.poses)) if (generated.test(name)) delete updated.poses[name];
Object.assign(updated.poses, newPoses);
Object.assign(updated.animations, animations);
if (check) {
  const onDisk = JSON.parse(await readFile(posesPath, 'utf8'));
  if (!isDeepStrictEqual(onDisk, updated)) stale.push(posesPath.pathname);
} else {
  // Patched through Python like the kicks, so the number format of the other poses stays untouched.
  const patch = { ids, poses: newPoses, animations };
  await new Promise((resolve, reject) => {
    const child = execFile(PYTHON, ['-c', [
      'import json,re,sys',
      'from pathlib import Path',
      'p=Path(sys.argv[1]); data=json.loads(p.read_text()); patch=json.load(sys.stdin)',
      "pattern=re.compile('^(' + '|'.join(re.escape(i) for i in patch['ids']) + r')_\\d+$')",
      "for name in [n for n in data['poses'] if pattern.match(n)]: del data['poses'][name]",
      "data['poses'].update(patch['poses']); data['animations'].update(patch['animations'])",
      'p.write_text(json.dumps(data,indent=2)+chr(10))',
    ].join('\n'), posesPath.pathname], error => error ? reject(error) : resolve(undefined));
    child.stdin.end(JSON.stringify(patch));
  });
}
{
  const text = `${JSON.stringify(moves, null, 2)}\n`;
  if (check) { if (await readFile(movesPath, 'utf8') !== text) stale.push(movesPath.pathname); }
  else await writeFile(movesPath, text);
}
if (stale.length) throw Error(`throws: generated data stale: ${stale.join(', ')} (npm run generate:throws)`);
console.log(`Throws ${check ? 'up to date' : 'generated'}: ${ids.length} clips, ${throwMoves.length} moves.`);
