/** Shared baker for authored kicks: poses, frame boxes and hold commands. */
import { createServer } from 'vite';
import { isDeepStrictEqual } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { PYTHON } from '../python.mjs';
import { bake, toAbsolute, toAnglePose, legFK, add } from './rig.mjs';
export async function generateKick(definition) {

const check = process.argv.includes('--check');
const posesPath = new URL('../../src/data/poses.json', import.meta.url);
const movesPath = new URL('../../src/data/moves.json', import.meta.url);
const poses = JSON.parse(await readFile(posesPath, 'utf8'));
const moves = JSON.parse(await readFile(movesPath, 'utf8'));
const bodies = JSON.parse(await readFile(new URL('../../src/data/bodies.json', import.meta.url), 'utf8'));

// ------------------------------------------------------------- 1. Posen ----
// Die Grundstellung so, wie der Idle-Clip sie zeichnet: am Boden, tiefster Fuß
// auf dem Boden.
const guardPose = poses.poses.guard;
const guard = toAbsolute(guardPose);
const feet = { left: legFK(guard.left), right: legFK(guard.right) };
const floorShift = Math.max(feet.left[1], feet.right[1]) + guard.hip[1];
guard.hip = [guard.hip[0], guard.hip[1] - floorShift];
guard.leftFoot = add(guard.hip, feet.left); guard.rightFoot = add(guard.hip, feet.right);
guard.leftFoot[1] = 0; guard.rightFoot[1] = 0;
const exactGuard = { ...structuredClone(guardPose), root: [guard.hip[0], guard.hip[1]] };

const def = definition(guard);
const { id, duration } = def;
const { startup, active, recovery } = def.frame;
const strikes = def.strikes ?? [{ from: startup, to: startup + active - 1, joint: def.kickFoot, group: 'main' }];
if (startup + active + recovery !== duration) throw Error(`${id}: Framedata ≠ Animationslänge`);

const newPoses = {};
const keyframes = bake(def, guard).map(({ state, depths }, frame) => {
  const name = `${id}_${frame}`;
  const shoulders = def.shoulders?.(state, frame) ?? guard.shoulders;
  newPoses[name] = frame === 0 || frame === duration - 1 ? exactGuard : toAnglePose(state, shoulders);
  const key = { frame, pose: name, easing: 'linear' };
  if (state.yaw !== undefined) {
    key.yaw = Math.round(state.yaw * 1000) / 1000;
    // Die echte Drehung kippt Ebenen und Zeichenreihenfolge.
    key.turn = Math.round((1 - Math.cos(state.yaw * Math.PI / 180)) / 2 * 1e6) / 1e6;
  }
  if (def.turn) key.turn = def.turn(frame);
  if (state.headYaw !== undefined) key.headYaw = Math.round(state.headYaw * 1000) / 1000;
  if (depths) key.depths = depths;
  return key;
});
const animation = {
  durationFrames: duration, loop: false, grounded: false, clampFloor: true, interpolation: 'angles',
  trail: { joint: def.kickFoot, ...def.trail }, keyframes,
};
const kneeStrikes = strikes.filter(s => s.joint.endsWith('Knee'));
if (kneeStrikes.length) {
  // Knie-Treffer wie bei den stehenden Kicks: Fußspur als `trail`, die
  // Knie-Spur (Swoosh) endet mit dem Knie-Fenster.
  animation.trails = kneeStrikes.map(s => ({ joint: s.joint, fromFrame: s.trail?.fromFrame ?? s.from - 6, toFrame: s.to, historyFrames: s.trail?.historyFrames ?? 6 }));
} else if (def.strikes) {
  delete animation.trail;
  animation.trails = strikes.map(s => ({ joint: s.joint, fromFrame: s.from - 4, toFrame: s.to + 2, historyFrames: 3 }));
}
// Alte Posen dieses Tritts entfernen, damit eine kürzere Fassung nichts zurücklässt.
for (const name of Object.keys(poses.poses)) if (name.startsWith(`${id}_`)) delete poses.poses[name];
Object.assign(poses.poses, newPoses);
poses.animations[id] = animation;

// -------------------------------------------------- 2. Boxen und Framedata ----
// Durch den Produktionsrenderer abtasten; im Check-Modus werden die Posen im
// Speicher eingespielt, damit keine veralteten Dateien hereinlecken.
const server = await createServer({ server: { middlewareMode: true, ws: false, hmr: false, watch: null }, appType: 'custom' });
try {
  const runtime = await server.ssrLoadModule('/src/render/skeleton.ts');
  const { FIGURE_SCALE } = await server.ssrLoadModule('/src/data/figure-scale.ts');
  const rawPoses = await server.ssrLoadModule('/src/data/poses.json');
  Object.assign(rawPoses.default.poses, poses.poses);
  Object.assign(runtime.animations, { [id]: animation });
  const { strikeCapsule, kneeCapsule, capsuleBoxes } = await server.ssrLoadModule('/src/data/contact-shapes.ts');
  // `boxes: 'spin'`: hit- and hurtboxes as for the spin kicks (spin-boxes.ts):
  // one box around knee and foot of the striking leg, wherever it points
  // (front or back), and a hurtbox per bone.
  const { spinFrameBoxes } = await server.ssrLoadModule('/src/data/spin-boxes.ts');

  const toBox = (points, margin) => {
    const x = Math.floor((Math.min(...points.map(p => p[0])) - margin) * 256), y = Math.floor((Math.min(...points.map(p => p[1])) - margin) * 256);
    return { x, y, width: Math.ceil((Math.max(...points.map(p => p[0])) + margin) * 256) - x, height: Math.ceil((Math.max(...points.map(p => p[1])) + margin) * 256) - y };
  };
  const ranges = [];
  for (let frame = 0; frame < duration; frame++) {
    const pose = runtime.samplePose(id, frame);
    const strike = strikes.find(s => frame >= s.from && frame <= s.to);
    if (def.boxes === 'spin') {
      const side = (strike?.joint ?? def.kickFoot).startsWith('right') ? 'right' : 'left';
      const range = { from: frame, to: frame, ...spinFrameBoxes(pose, Boolean(strike), side, strike?.group ?? 'main') };
      const previous = ranges.at(-1), same = r => JSON.stringify([r.hitboxes, r.hurtboxes, r.pushbox]);
      if (previous && same(previous) === same(range)) previous.to = frame; else ranges.push(range);
      continue;
    }
    const isActive = Boolean(strike);
    const isKnee = Boolean(strike?.joint.endsWith('Knee'));
    // `hurtJoint` lets a mixed punch/kick chain name the limb that is out between its strikes.
    const joint = isKnee ? strike.joint.replace('Knee', 'Foot') : kneeStrikes.length ? def.kickFoot
      : strike?.joint ?? def.hurtJoint?.(frame) ?? (frame < (strikes[1]?.from ?? Infinity) - 8 ? strikes[0].joint : strikes.at(-1).joint);
    const knee = joint.replace('Foot', 'Knee').replace('Hand', 'Elbow');
    const capsule = !strike ? null : isKnee ? kneeCapsule(pose, strike.joint.startsWith('right') ? 'right' : 'left') : strikeCapsule(pose, joint);
    const hitboxes = capsule ? capsuleBoxes(capsule).map(box => ({ ...box, hitGroup: strike.group })) : [];
    // Ein ausgestrecktes Bein ist trefferbar (Whiff Punish), wie bei den übrigen Kicks.
    const extended = pose[joint][0] - pose.hip[0] > 16 || (isActive && !isKnee);
    const hurtboxes = [...structuredClone(bodies.standing.hurtboxes), ...(extended ? [toBox([pose[knee], pose[joint]], 5)] : [])];
    const range = { from: frame, to: frame, hitboxes, hurtboxes, pushbox: structuredClone(bodies.standing.pushbox) };
    const previous = ranges.at(-1), same = r => JSON.stringify([r.hitboxes, r.hurtboxes, r.pushbox]);
    if (previous && same(previous) === same(range)) previous.to = frame; else ranges.push(range);
  }

  // Reuse the standing hold-command metadata; the definition selects the striking leg.
  const template = moves.find(move => move.id === 'spin_mk');
  if (!template) throw Error('spin_mk template missing in moves.json');
  const move = {
    ...structuredClone(template), id,
    button: def.button,
    command: { type: 'hold', directions: [def.direction ?? 4], buttons: def.buttons ?? [def.button], trigger: 'pressed', priority: def.priority ?? (def.buttons ? 20 : 10),
      ...(def.resource ? { resource: def.resource } : {}) },
    animation: id, startup, active, recovery, ...def.hit,
    multiHit: strikes.length > 1,
    hitGroups: strikes.map(s => ({ id: s.group, maxHitsPerTarget: 1, ...s.hit })),
    cancelWindows: [],
    frameRanges: ranges,
  };
  if (def.standingHitstun) move.standingHitstun = true; else delete move.standingHitstun;
  // Definitions use rig units; simulation displacement uses scaled fixed-point pixels.
  if (def.advance) move.advance = { frames: def.advance.frames, distance: Math.round(def.advance.distance * FIGURE_SCALE * 256) };
  else delete move.advance;
  const index = moves.findIndex(m => m.id === id);
  if (index < 0) moves.push(move); else moves[index] = move;
} finally { await server.close(); }

// ------------------------------------------------------------ 3. Schreiben ----
// poses.json wird über Python gepatcht: so bleiben Zahlenschreibweise und
// Reihenfolge der übrigen (teils von Python erzeugten) Posen unberührt.
const stale = [];
if (check) {
  const onDisk = JSON.parse(await readFile(posesPath, 'utf8'));
  if (!isDeepStrictEqual(onDisk, poses)) stale.push(posesPath.pathname);
} else {
  const patch = { prefix: `${id}_`, poses: newPoses, animations: { [id]: animation } };
  await new Promise((resolve, reject) => {
    const child = execFile(PYTHON, ['-c', [
      'import json,sys',
      'from pathlib import Path',
      'p=Path(sys.argv[1]); data=json.loads(p.read_text()); patch=json.load(sys.stdin)',
      "for name in [n for n in data['poses'] if n.startswith(patch['prefix'])]: del data['poses'][name]",
      "data['poses'].update(patch['poses']); data['animations'].update(patch['animations'])",
      'p.write_text(json.dumps(data,indent=2)+chr(10))',
    ].join('\n'), posesPath.pathname], error => error ? reject(error) : resolve(undefined));
    child.stdin.end(JSON.stringify(patch));
  });
}
{
  const text = JSON.stringify(moves, null, 2) + '\n';
  if (check) { if (await readFile(movesPath, 'utf8') !== text) stale.push(movesPath.pathname); }
  else await writeFile(movesPath, text);
}
if (stale.length) throw Error(`${id}: generated data stale: ${stale.join(', ')}`);
console.log(check ? `${id}: generated data current.` : `${id}: ${duration} frames, ${startup}/${active}/${recovery}, ${def.direction === 6 ? "forward" : "back"} + ${(def.buttons ?? [def.button]).join("+")}.`);
}
