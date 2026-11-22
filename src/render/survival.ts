import { FIGURE_SCALE } from '../data/figure-scale';
import rules from '../data/rules.json';
import type { HitLevel } from '../data/schema';
import type { Fighter } from '../simulation/types';
import type { Palette } from '../platform/theme';
import { t } from '../platform/i18n';
import { formatSurvival, type Enemy, type SurvivalState } from '../survival/state';
import { drawFigure, drawTrail } from './figure';
import { fighterDepths } from './depth';
import { MIRROR_YAW_ANIMATIONS, animationId, animationTrails, animations, fighterPose, isKneeTrail, sampleHeadYaw, sampleRotationTrail, sampleTrails, sampleTurn } from './skeleton';
import type { HitEffects } from './effects';
import { DEFAULT_STAGE, STAGE_VIEW, drawContactShadow, drawStage, stagePan, type StageId } from './stages';

/*
 * Survival renderer. Presentation only: reads the survival state, never writes
 * it. Same figure pipeline as the versus renderer (poses, trails, depth,
 * shadows, effects), for any number of fighters. The player's turn is drawn
 * as a short horizontal squash through the front view, flipping at its middle.
 * Back attackers flash and carry a "!" during their warning.
 */

const ground = STAGE_VIEW.ground, U = rules.unit;
/** KO'd enemies blink during their last frames before they vanish. */
const BLINK_FRAMES = 24;
/** Narrowest silhouette (share of the normal width) in the middle of a turn. */
const TURN_MIN_WIDTH = .3;

interface Figure { f: Fighter; old: Fighter; enemy?: Enemy; level?: HitLevel }

/** Hit level of the last unblocked contact that hit this fighter (for the hit pose). */
function hitLevels(state: SurvivalState): { player?: HitLevel; enemies: Map<number, HitLevel | undefined> } {
  const enemies = new Map<number, HitLevel | undefined>();
  let player: HitLevel | undefined, latest = -1;
  for (const e of state.enemies) {
    const contact = e.pair.lastContact;
    enemies.set(e.uid, contact && contact.defender === 1 && !contact.blocked ? contact.hitLevel : undefined);
    if (contact && contact.defender === 0 && !contact.blocked && contact.frame > latest) { latest = contact.frame; player = contact.hitLevel; }
  }
  return { player, enemies };
}

/** Enemy colours (never blue, the player's colour), picked for contrast against the arena in each theme. */
const ENEMY_COLORS = {
  dark: ['#ff3040', '#ff8a1f', '#ffe040', '#7dff4f', '#ff4fd8', '#c996ff'],
  light: ['#bc1720', '#c25a00', '#8a6d00', '#2f7d1a', '#b0197f', '#7836a5'],
} as const;
function enemyColor(uid: number): string {
  const set = ENEMY_COLORS[document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'];
  return set[(uid - 1) % set.length];
}

export function renderSurvival(canvas: HTMLCanvasElement, state: SurvivalState, previous: SurvivalState, alpha: number, paused: boolean, palette: Palette, stage: StageId = DEFAULT_STAGE, effects?: HitEffects, best = 0): void {
  const ctx = canvas.getContext('2d')!;
  const scale = (canvas.width || 960) / 960;
  if (scale !== 1) ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, 960, 420);
  const camera = effects?.camera(paused);
  if (camera) { ctx.save(); ctx.translate(camera.cx + camera.x, camera.cy + camera.y); ctx.scale(camera.zoom, camera.zoom); ctx.translate(-camera.cx, -camera.cy); }
  const frozen = Boolean(state.hitstop || paused), a = frozen ? 0 : alpha;
  const lerp = (f: Fighter, old: Fighter) => [(old.x + (f.x - old.x) * alpha) / U, ground + (old.y + (f.y - old.y) * alpha) / U];
  const levels = hitLevels(state);
  const player: Figure = { f: state.player, old: previous.player, level: levels.player };
  drawStage(ctx, stage, palette, stagePan(lerp(player.f, player.old)[0]), scale);

  // Fallen enemies at the back, then the living ones, the player on top.
  const crowd: Figure[] = state.enemies.map(e => ({ f: e.fighter, old: previous.enemies.find(o => o.uid === e.uid)?.fighter ?? e.fighter, enemy: e, level: levels.enemies.get(e.uid) }))
    .sort((x, y) => Number(!x.enemy!.dead) - Number(!y.enemy!.dead));
  const figures = [...crowd, player].map(figure => {
    const { f, old, enemy, level } = figure;
    const [x, y] = lerp(f, old);
    const koTime = f.state === 'KO' ? Math.min(animations.KO.durationFrames - 1, f.stateFrame + a) : undefined;
    let pose = fighterPose(f, old, alpha, frozen, level, koTime);
    let facing = f.state === 'Attack' ? f.attackFacing : f.facing, yaw: number | undefined;
    if (!enemy && state.turn) {
      // Turn: the limbs close in on the body axis towards the front view (head
      // stays round, both eyes show), then open up on the other side.
      const u = Math.min(1, (state.turn.frame + a) / state.config.turn.frames);
      const squash = TURN_MIN_WIDTH + (1 - TURN_MIN_WIDTH) * Math.abs(Math.cos(Math.PI * u));
      const axis = pose.hip[0];
      pose = Object.fromEntries(Object.entries(pose).map(([joint, p]) => [joint, [axis + (p[0] - axis) * squash, p[1]]]));
      facing = u < .5 ? state.turn.from : state.turn.from === 1 ? -1 : 1;
      yaw = -90 * Math.sin(Math.PI * u);
    }
    return { ...figure, x, y, koTime, pose, facing, yaw };
  });

  for (const { enemy, x, y, pose, facing } of figures) {
    if (enemy?.dead && blinkHidden(enemy, state)) continue;
    const xs = Object.values(pose).map(p => p[0] * facing * FIGURE_SCALE), bottom = Math.max(...Object.values(pose).map(p => p[1])) * FIGURE_SCALE;
    drawContactShadow(ctx, x + (Math.min(...xs) + Math.max(...xs)) / 2, (Math.max(...xs) - Math.min(...xs)) / 2, ground - (y + bottom), palette);
  }
  for (const { f, enemy, x, y, koTime, pose, facing, yaw, level } of figures) {
    if (enemy?.dead && blinkHidden(enemy, state)) continue;
    ctx.save(); ctx.translate(x, y); ctx.scale(FIGURE_SCALE, FIGURE_SCALE);
    const color = enemy ? enemyColor(enemy.uid) : palette.p1;
    const time = (f.state === 'Attack' ? f.moveFrame : f.stateFrame) + a;
    if (f.state === 'Attack' && f.moveId) {
      const trails = animationTrails(f.moveId), samples = sampleTrails(f.moveId, time);
      trails.forEach((trail, index) => {
        if (isKneeTrail(trail)) return;
        const fade = Math.min(1, Math.max(0, (trail.toFrame + trail.historyFrames - time) / trail.historyFrames));
        drawTrail(ctx, samples[index], color, fade * (trail.directional ? 1 : .68), trail.directional ?? false, facing, trail.directional ? palette.revenge : palette.special);
      });
      drawTrail(ctx, sampleRotationTrail(f.moveId, time), palette.revenge, .72, true, facing, palette.special);
    }
    const hitFlash = level && ['Hitstun', 'Knockdown', 'KO'].includes(f.state) ? Math.max(0, 1 - (koTime ?? f.stateFrame) / 3) : 0;
    const warnFlash = enemy?.warn ? .3 + .35 * Math.abs(Math.sin(state.frame * .35)) : 0;
    const id = animationId(f, level);
    drawFigure(ctx, pose, color, palette, facing, Math.max(hitFlash, warnFlash), fighterDepths(f, alpha, frozen, level), sampleTurn(id, time), yaw ?? sampleHeadYaw(id, time), animations[id].fixedLegDepth, MIRROR_YAW_ANIMATIONS.has(id));
    ctx.restore();
    if (enemy?.warn) drawWarning(ctx, x, y + Math.min(...Object.values(pose).map(p => p[1])) * FIGURE_SCALE, state.frame, palette);
  }
  effects?.drawWorld(ctx, frozen ? 0 : alpha, palette);
  if (camera) ctx.restore();
  effects?.drawOverlay(ctx, palette);

  const banner = (text: string, y: number, font: string, halo: number) => {
    ctx.font = font; ctx.lineJoin = 'round'; ctx.strokeStyle = palette.arena; ctx.lineWidth = halo; ctx.strokeText(text, 480, y);
    ctx.fillStyle = palette.text; ctx.fillText(text, 480, y);
  };
  ctx.textAlign = 'center';
  if (paused) banner('PAUSE', 155, 'bold 34px Arial', 7);
  else if (state.over) {
    banner(t('survival.over', { time: formatSurvival(state.survivedFrames) }), 150, 'bold 34px Arial', 7);
    const record = state.survivedFrames >= best && best > 0;
    banner(record ? t('survival.newBest') : t('survival.best', { time: formatSurvival(Math.max(best, state.survivedFrames)) }), 178, '12px monospace', 4);
    banner(t('survival.restart'), 198, '11px monospace', 4);
  }
  ctx.textAlign = 'left'; ctx.lineJoin = 'miter';
}

function blinkHidden(enemy: Enemy, state: SurvivalState): boolean {
  const left = state.config.enemies.koRemoveFrames - enemy.koFrames;
  return left < BLINK_FRAMES && Math.floor(left / 3) % 2 === 0;
}

/** Pulsing "!" above a back attacker's head. */
function drawWarning(ctx: CanvasRenderingContext2D, x: number, top: number, frame: number, palette: Palette): void {
  const pulse = 1 + .18 * Math.abs(Math.sin(frame * .35));
  ctx.save(); ctx.translate(x, top - 16); ctx.scale(pulse, pulse);
  ctx.font = 'bold 22px Arial'; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
  ctx.strokeStyle = palette.arena; ctx.lineWidth = 5; ctx.strokeText('!', 0, 0);
  ctx.fillStyle = palette.revenge; ctx.fillText('!', 0, 0);
  ctx.restore();
}
