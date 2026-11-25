import contactGeometry from '../data/contact-geometry';
import { FIGURE_SCALE } from '../data/figure-scale';
import rig from '../data/poses.json';
import rules from '../data/rules.json';
import { MOVES } from '../data/schema';
import type { Capsule } from '../data/contact-shapes';
import type { RawInput } from '../input/types';
import type { Fighter, GameState } from './types';

/**
 * Versus round intro (versus, VS CPU and demo; never training or survival):
 *
 *   ready    – both fighters stand at their spawns, "READY UP!" is shown.
 *   approach – both walk towards each other until the tips of their extended
 *              standing LP fists would touch exactly (derived from the baked
 *              contact geometry, see saluteDistance).
 *   salute   – both play the standing LP animation; the fists meet at the
 *              move's furthest extension. No hitbox, damage or resources: the
 *              combat step does not run during the intro at all.
 *   fight    – the round is already 'fighting' (inputs and timer run); the
 *              step only keeps the "FIGHT!" banner on screen.
 *
 * Inputs are locked during ready/approach/salute. Everything is counted in
 * simulation frames; nothing here depends on time or randomness.
 */
export const INTRO_READY_FRAMES = 60;
export const INTRO_SALUTE_FRAMES = 20;
export const INTRO_FIGHT_FRAMES = 40;
/** The move both fighters greet with. */
export const SALUTE_MOVE = 'standing_lp';
/** Upper bound of approach frames (whole stage at walking speed), used by snapshot validation. */
export const INTRO_MAX_APPROACH_FRAMES = Math.ceil(rules.stageWidth / rules.forwardSpeed) + 1;

export type IntroStep = 'ready' | 'approach' | 'salute' | 'fight';
export interface IntroState { step: IntroStep; frame: number }
export const INTRO_STEPS: readonly IntroStep[] = ['ready', 'approach', 'salute', 'fight'];
/** Steps during which the round phase is 'intro' (inputs locked, timer stopped). */
export const LOCKED_INTRO_STEPS: readonly IntroStep[] = ['ready', 'approach', 'salute'];

interface Geometry { frames: { body: Capsule[] }[] }
/** Capsule index of every hand bone (capsule 0 is the head, then one per bone). */
const HAND_CAPSULES = rig.skeleton.bones.flatMap((bone, index) => bone.joint.endsWith('Hand') ? [index + 1] : []);
const scaled = (value: number) => Math.round(value * FIGURE_SCALE);

/**
 * Forward reach (subpixels, from the fighter's x) of the foremost fist tip in
 * `frame` of `moveId`: hand joint plus capsule radius, scaled and rounded
 * exactly like the runtime contact geometry (simulation/pose-contact).
 */
export function fistReach(moveId: string, frame: number): number {
  const clip = (contactGeometry as unknown as Record<string, Geometry>)[moveId];
  const body = clip.frames[Math.min(frame, clip.frames.length - 1)].body;
  return Math.max(...HAND_CAPSULES.map(index => scaled(body[index][2]) + scaled(body[index][4])));
}

/** Move frame in which the fist is extended furthest (first one on a tie). */
export function saluteFrame(moveId = SALUTE_MOVE): number {
  let best = 0;
  for (let frame = 1; frame < MOVES[moveId].duration; frame++) if (fistReach(moveId, frame) > fistReach(moveId, best)) best = frame;
  return best;
}
export const SALUTE_PEAK_FRAME = saluteFrame();

/** World x of a fighter's foremost fist tip at `frame` of the salute move. */
export function fistTipX(f: Pick<Fighter, 'x'> & { facing: number }, frame = SALUTE_PEAK_FRAME, moveId = SALUTE_MOVE): number {
  return f.x + f.facing * fistReach(moveId, frame);
}

/**
 * Distance between both fighters' x at which their fist tips touch exactly at
 * the salute peak. Each side uses its own move data (both greet with the same
 * move today, so the value is symmetric).
 */
export function saluteDistance(moveIds: readonly [string, string] = [SALUTE_MOVE, SALUTE_MOVE]): number {
  return moveIds.reduce((sum, id) => sum + fistReach(id, saluteFrame(id)), 0);
}
export const SALUTE_DISTANCE = saluteDistance();

/** Height (subpixels, negative is up) of the touching fists at the salute peak. */
export function saluteHeight(moveId = SALUTE_MOVE): number {
  const body = (contactGeometry as unknown as Record<string, Geometry>)[moveId].frames[SALUTE_PEAK_FRAME].body;
  const hand = HAND_CAPSULES.reduce((a, b) => body[b][2] > body[a][2] ? b : a);
  return scaled(body[hand][3]);
}

/** The point where both fists meet, while the salute is at its peak this frame; otherwise null. */
export function saluteContact(game: GameState): { x: number; y: number } | null {
  const intro = game.round.intro;
  if (game.round.phase !== 'intro' || intro?.step !== 'salute') return null;
  const [a, b] = game.fighters;
  if (a.state !== 'Attack' || b.state !== 'Attack' || a.moveFrame !== SALUTE_PEAK_FRAME || b.moveFrame !== SALUTE_PEAK_FRAME) return null;
  return { x: Math.round((fistTipX(a) + fistTipX(b)) / 2), y: saluteHeight() };
}

function setState(f: Fighter, state: Fighter['state']): void {
  if (f.state !== state) { f.state = state; f.stateFrame = 0; }
  f.remaining = 0;
}

/** One walk frame towards the salute distance. Returns false once it is reached. */
function approach(game: GameState): boolean {
  const [left, right] = game.fighters[0].x <= game.fighters[1].x ? game.fighters : [game.fighters[1], game.fighters[0]];
  const gap = right.x - left.x - SALUTE_DISTANCE;
  if (gap <= 0) return false;
  const leftStep = Math.min(rules.forwardSpeed, Math.ceil(gap / 2)), rightStep = Math.min(rules.forwardSpeed, gap - leftStep);
  for (const [f, distance] of [[left, leftStep], [right, rightStep]] as const) {
    setState(f, 'Walk');
    f.vx = f.facing * rules.forwardSpeed;
    f.x += f.facing * distance;
  }
  return true;
}

function startSalute(f: Fighter): void {
  f.vx = 0; f.state = 'Attack'; f.stateFrame = 0; f.remaining = 0;
  f.moveId = SALUTE_MOVE; f.moveFrame = 0; f.attackFacing = f.facing; f.attackId++; f.hitTargets = [];
}

/** Ends the intro: inputs and the round timer start with the next frame. */
function startFight(game: GameState): void {
  for (const f of game.fighters) { f.vx = 0; f.moveId = null; setState(f, 'Idle'); }
  game.round.phase = 'fighting';
  game.round.intro = { step: 'fight', frame: 0 };
}

/**
 * One locked intro frame. The raw inputs are only remembered as "previous" so
 * a button held through the intro does not count as a fresh press at FIGHT.
 */
export function stepIntro(game: GameState, inputs: [RawInput, RawInput]): void {
  game.frame++;
  const intro = game.round.intro;
  // Snapshot validation guarantees an intro state during the intro phase.
  if (!intro) { game.round.phase = 'fighting'; return; }
  for (const f of game.fighters) {
    f.input.previous = { ...inputs[f.id], taps: 0 };
    f.input.pending = null;
    f.stateFrame++;
  }
  intro.frame++;
  if (intro.step === 'ready') {
    if (intro.frame >= INTRO_READY_FRAMES) game.round.intro = { step: 'approach', frame: 0 };
  } else if (intro.step === 'approach') {
    if (!approach(game)) {
      for (const f of game.fighters) startSalute(f);
      game.round.intro = { step: 'salute', frame: 0 };
    }
  } else if (intro.step === 'salute') {
    for (const f of game.fighters) {
      if (f.state !== 'Attack' || !f.moveId) continue;
      if (++f.moveFrame >= MOVES[f.moveId].duration) { f.moveId = null; setState(f, 'Idle'); }
    }
    if (intro.frame >= INTRO_SALUTE_FRAMES) startFight(game);
  }
}

/** Counts down the FIGHT banner once the round runs. */
export function advanceFightBanner(game: GameState): void {
  const intro = game.round.intro;
  if (intro?.step === 'fight' && ++intro.frame >= INTRO_FIGHT_FRAMES) game.round.intro = null;
}
