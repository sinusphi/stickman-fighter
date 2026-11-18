/**
 * Pose authoring for Kicks 2.0.
 *
 * Kicks are authored as a few key poses in *absolute* screen angles (degrees,
 * +x = towards the opponent, +y = down, 0° = pointing forward, -90° = up) and
 * baked to one engine keyframe per simulation frame. Baking every frame lets the
 * support foot stay exactly planted (2-bone IK per frame) and keeps kick lines
 * straight where a thrust needs them, while the engine keeps its fixed bone
 * lengths and ordinary angle interpolation between frames.
 *
 * Leg specs (per key, per leg):
 *   { thigh, shin }                         absolute bone angles
 *   { foot:[x,y], knee:±1, space:'ground' } foot on the floor plane, in the
 *                                           coordinates of the move's first frame
 *                                           (forward steps are compensated)
 *   { foot:[x,y], knee:±1, space:'hip' }    foot relative to the hip
 * knee +1 puts the knee on the forward/upper side of the hip→foot line,
 * -1 on the other side (needed while the body faces away).
 */

export const THIGH = 25, SHIN = 25, LEG = THIGH + SHIN;
const RAD = Math.PI / 180;
export const deg = r => r / RAD;
export const polar = (angle, length) => [Math.cos(angle * RAD) * length, Math.sin(angle * RAD) * length];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const norm = a => { let v = ((a % 360) + 540) % 360 - 180; if (v === -180) v = 180; return v; };
const round = (v, digits = 4) => Math.round(v * 10 ** digits) / 10 ** digits;

/** Two-bone IK with equal bone lengths. Returns absolute thigh/shin angles. */
export function legIK(hipToFoot, knee = 1) {
  const [dx, dy] = hipToFoot;
  const distance = Math.min(Math.hypot(dx, dy), LEG * 0.9995);
  const bend = Math.acos(distance / LEG) * knee;
  const angle = deg(Math.atan2(dy, dx));
  return { thigh: angle - deg(bend), shin: angle + deg(bend) };
}
export const legFK = ({ thigh, shin }) => add(polar(thigh, THIGH), polar(shin, SHIN));

/** Absolute description of an engine AnglePose (shoulders keep their relative
 * angle to the torso, exactly as in the guard). */
export function toAbsolute(pose) {
  const a = pose.angles, torso = a.neck;
  const lUp = torso + a.leftShoulder + a.leftElbow, rUp = torso + a.rightShoulder + a.rightElbow;
  return {
    hip: [...pose.root], torso, head: torso + a.head,
    arms: { l: [lUp, lUp + a.leftHand], r: [rUp, rUp + a.rightHand] },
    left: { thigh: a.leftKnee, shin: a.leftKnee + a.leftFoot },
    right: { thigh: a.rightKnee, shin: a.rightKnee + a.rightFoot },
    shoulders: { l: a.leftShoulder, r: a.rightShoulder },
  };
}

export function toAnglePose(state, shoulders) {
  const { torso, head, arms, left, right, hip } = state;
  const angles = {
    neck: torso, head: head - torso,
    leftShoulder: shoulders.l, rightShoulder: shoulders.r,
    leftElbow: arms.l[0] - (torso + shoulders.l), leftHand: arms.l[1] - arms.l[0],
    rightElbow: arms.r[0] - (torso + shoulders.r), rightHand: arms.r[1] - arms.r[0],
    leftKnee: left.thigh, leftFoot: left.shin - left.thigh,
    rightKnee: right.thigh, rightFoot: right.shin - right.thigh,
  };
  return { root: hip.map(v => round(v)), angles: Object.fromEntries(Object.entries(angles).map(([k, v]) => [k, round(norm(v))])) };
}

// ---------------------------------------------------------------- easing ----
const EASE = {
  lin: t => t,
  in: t => t * t,                      // accelerate into the key (strikes)
  in3: t => t * t * t,
  out: t => 1 - (1 - t) ** 3,          // decelerate into the key
  io: t => t * t * (3 - 2 * t),
};
/** Monotone cubic Hermite (same idea as the engine's arm interpolation):
 * carries motion through intermediate keys, never overshoots, stops at holds. */
function hermite(values, times, index, t) {
  const a = values[index], b = values[index + 1], h = times[index + 1] - times[index];
  const slope = (b - a) / h;
  const tangent = (s0, s1, h0, h1) => {
    if (s0 * s1 <= 0) return 0;
    const w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;
    return (w1 + w2) / (w1 / s0 + w2 / s1);
  };
  const m0 = index > 0 ? tangent((a - values[index - 1]) / (times[index] - times[index - 1]), slope, times[index] - times[index - 1], h) : 0;
  const m1 = index + 2 < values.length ? tangent(slope, (values[index + 2] - b) / (times[index + 2] - times[index + 1]), h, times[index + 2] - times[index + 1]) : 0;
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * a + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * b + (t3 - t2) * h * m1;
}

/**
 * Bake a kick.
 * @param {any} def   kick definition: id, duration, keys[], optional advance {frames, distance (rig units)}
 * @param {any} guard absolute guard (toAbsolute of poses.guard with floor-corrected hip)
 * Every key inherits unspecified fields from the previous key.
 */
export function bake(def, guard) {
  const advance = f => {
    if (!def.advance) return 0;
    const t = Math.max(0, Math.min(1, f / def.advance.frames));
    return def.advance.distance * t * t * (3 - 2 * t);
  };
  // 1. Resolve inheritance.
  const keys = [];
  let previous = { hip: guard.hip, torso: guard.torso, head: guard.head, arms: guard.arms,
    left: { foot: guard.leftFoot, knee: 1, space: 'ground' }, right: { foot: guard.rightFoot, knee: 1, space: 'ground' },
    yaw: undefined, headYaw: undefined };
  for (const raw of def.keys) {
    const key = { ...previous, ...raw, depths: raw.depths };
    // Without an explicit head the head keeps its angle to the torso.
    if (raw.head === undefined && raw.torso !== undefined) key.head = previous.head - previous.torso + raw.torso;
    if (typeof key.head === 'function') key.head = key.head(key.torso);
    if (typeof key.arms === 'function') key.arms = key.arms(key.torso);
    keys.push(key);previous = { ...key };
  }
  if (keys[0].f !== 0 || keys.at(-1).f !== def.duration - 1) throw Error(`${def.id}: keys must span 0..${def.duration - 1}`);
  // Arms and head: take the equivalent angle nearest to the previous key, so a
  // helper returning e.g. -223° instead of 137° cannot spin a limb around.
  const near = (value, reference) => value + 360 * Math.round((reference - value) / 360);
  for (let k = 1; k < keys.length; k++) {
    const p = keys[k - 1], key = keys[k];
    key.head = near(key.head, p.head);
    key.arms = {
      l: key.arms.l.map((angle, bone) => near(angle, p.arms.l[bone])),
      r: key.arms.r.map((angle, bone) => near(angle, p.arms.r[bone])),
    };
  }
  const times = keys.map(k => k.f);

  // 2. Every leg in all three representations at its key.
  const legReps = side => keys.map(key => {
    const spec = key[side], hip = key.hip, adv = advance(key.f);
    let angles, hipFoot;
    if (spec.foot) {
      hipFoot = spec.space === 'hip' ? spec.foot : [spec.foot[0] - adv - hip[0], spec.foot[1] - hip[1]];
      angles = legIK(hipFoot, spec.knee ?? 1);
    } else {
      angles = { thigh: spec.thigh, shin: spec.shin };
      hipFoot = legFK(angles);
    }
    return { mode: spec.foot ? spec.space ?? 'ground' : 'angles', knee: spec.knee ?? 1, angles, hipFoot,
      groundFoot: [hipFoot[0] + hip[0] + adv, hipFoot[1] + hip[1]] };
  });
  // IK angles come back in (-180, 180]; authored angles may be unwrapped on
  // purpose (e.g. 215° for a knee pulled up while facing away). Keep every
  // IK-derived key within half a turn of its predecessor.
  const unwrap = reps => {
    for (let k = 1; k < reps.length; k++) if (reps[k].mode !== 'angles') for (const bone of ['thigh', 'shin']) {
      const prev = reps[k - 1].angles[bone];
      while (reps[k].angles[bone] - prev > 180) reps[k].angles[bone] -= 360;
      while (reps[k].angles[bone] - prev < -180) reps[k].angles[bone] += 360;
    }
    return reps;
  };
  const legs = { left: unwrap(legReps('left')), right: unwrap(legReps('right')) };

  const frames = [];
  for (let f = 0; f < def.duration; f++) {
    let i = times.findIndex((time, index) => index + 1 < times.length && f >= time && f <= times[index + 1]);
    if (i < 0) i = times.length - 2;
    const A = keys[i], B = keys[i + 1], u = (f - A.f) / (B.f - A.f);
    const ease = B.ease ?? 'spline';
    const scalar = get => {
      const values = keys.map(get);
      if (values[i] === undefined && values[i + 1] === undefined) return undefined;
      if (ease === 'spline') return hermite(values.map(v => v ?? 0), times, i, u);
      const a = values[i] ?? 0, b = values[i + 1] ?? 0;
      return a + (b - a) * EASE[ease](u);
    };
    const state = {
      hip: [scalar(k => k.hip[0]), scalar(k => k.hip[1])],
      torso: scalar(k => k.torso), head: scalar(k => k.head),
      arms: { l: [scalar(k => k.arms.l[0]), scalar(k => k.arms.l[1])], r: [scalar(k => k.arms.r[0]), scalar(k => k.arms.r[1])] },
      yaw: scalar(k => k.yaw), headYaw: scalar(k => k.headYaw),
    };
    // A planted foot must stay reachable: if the authored hip is a touch too
    // high for a straight support leg, lower the hip instead of lifting the foot.
    for (const side of ['left', 'right']) {
      const a = legs[side][i], b = legs[side][i + 1];
      if (a.mode !== 'ground' || b.mode !== 'ground') continue;
      const t = u, ground = [a.groundFoot[0] + (b.groundFoot[0] - a.groundFoot[0]) * t, a.groundFoot[1] + (b.groundFoot[1] - a.groundFoot[1]) * t];
      const dx = ground[0] - advance(f) - state.hip[0], reach = LEG * 0.999;
      if (ground[1] === 0 && Math.hypot(dx, ground[1] - state.hip[1]) > reach) state.hip[1] = -Math.sqrt(reach * reach - dx * dx);
    }
    for (const side of ['left', 'right']) {
      const reps = legs[side], a = reps[i], b = reps[i + 1];
      const pick = get => reps.map(get);
      const interp = get => {
        const values = pick(get);
        if (ease === 'spline') return hermite(values, times, i, u);
        return values[i] + (values[i + 1] - values[i]) * EASE[ease](u);
      };
      const knee = u < 1 && a.knee !== b.knee ? (u < .5 ? a.knee : b.knee) : b.knee;
      if (a.mode === 'ground' && b.mode === 'ground') {
        const ground = [interp(r => r.groundFoot[0]), interp(r => r.groundFoot[1])];
        state[side] = legIK([ground[0] - advance(f) - state.hip[0], ground[1] - state.hip[1]], knee);
      } else if (a.mode === 'hip' && b.mode === 'hip') {
        state[side] = legIK([interp(r => r.hipFoot[0]), interp(r => r.hipFoot[1])], knee);
      } else {
        state[side] = { thigh: interp(r => r.angles.thigh), shin: interp(r => r.angles.shin) };
      }
    }
    def.finalizePose?.(state, f);
    frames.push({ state, depths: A.f === f ? A.depths : B.f === f ? B.depths : undefined });
  }
  return frames;
}
