import { FIGURE_SCALE } from '../data/figure-scale';
import rules from '../data/rules.json';
import type { HitLevel } from '../data/schema';
import type { Fighter } from '../simulation/types';
import type { Palette } from '../platform/theme';
import { t } from '../platform/i18n';
import { formatSurvival, type Enemy, type SurvivalState } from '../survival/state';
import { drawFigure, drawTrail } from './figure';
import { thrownOffset } from './canvas';
import { fighterDepths } from './depth';
import { MIRROR_YAW_ANIMATIONS, animationId, animationTrails, animations, fighterPose, isKneeTrail, sampleHeadYaw, sampleRotationTrail, sampleTrails, sampleTurn } from './skeleton';
import type { HitEffects } from './effects';
import { EdgeTracker, type EdgeMark } from './edge-marks';
import { DEFAULT_STAGE, STAGE_VIEW, drawContactShadow, drawStage, stagePan, type StageId } from './stages';

/*
 * Survival renderer. Presentation only: reads the survival state, never writes
 * it. Same figure pipeline as the versus renderer (poses, trails, depth,
 * shadows, effects), for any number of fighters. The player's turn is drawn
 * as a short horizontal squash through the front view, flipping at its middle.
 * Back attackers flash and carry a "!" during their warning. Enemies stuck
 * outside the canvas get an arrow at its edge (see edge-marks).
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
const BOSS_COLORS = { dark: '#ffc83a', light: '#a86f00' } as const;
/** Drawn size by tier: heavier enemies look a little bigger (hitboxes stay the same). */
const TIER_SCALE = { light: 1, medium: 1.03, heavy: 1.07 } as const;
const BOSS_SCALE = 1.14;
const enemyScale = (e?: Enemy): number => !e ? 1 : e.boss ? BOSS_SCALE : TIER_SCALE[e.tier];
function enemyColor(enemy: Enemy): string {
  const light = document.documentElement.dataset.theme === 'light';
  if (enemy.boss) return BOSS_COLORS[light ? 'light' : 'dark'];
  const uid = enemy.uid;
  const set = ENEMY_COLORS[document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'];
  return set[(uid - 1) % set.length];
}

/** Page layout the canvas drawing has to keep clear of. */
export interface SurvivalLayout {
  /** Bottom edge of the DOM HUD over the canvas, in logical canvas pixels. */
  hudBottom: number;
}

const edges = new EdgeTracker();

export function renderSurvival(canvas: HTMLCanvasElement, state: SurvivalState, previous: SurvivalState, alpha: number, paused: boolean, palette: Palette, stage: StageId = DEFAULT_STAGE, effects?: HitEffects, best = 0, layout?: SurvivalLayout): void {
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
    let [x, y] = lerp(f, old);
    // A thrown enemy hangs on the player's hands: sub-frame position from the throw table (as in versus).
    const held = enemy ? thrownOffset(enemy.pair, f, a) : null;
    if (held) { x = lerp(player.f, player.old)[0] + held[0] / U; y = ground + held[1] / U; }
    const koTime = f.state === 'KO' ? Math.min(animations.KO.durationFrames - 1, f.stateFrame + a) : undefined;
    let pose = fighterPose(f, old, alpha, frozen, level, koTime);
    let facing = f.state === 'Attack' || f.state === 'Thrown' ? f.attackFacing : f.facing, yaw: number | undefined;
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
    const grow = enemyScale(enemy);
    ctx.save(); ctx.translate(x, y); ctx.scale(FIGURE_SCALE * grow, FIGURE_SCALE * grow);
    const color = enemy ? enemyColor(enemy) : palette.p1;
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

  const marks = edges.update(state);
  drawEdgeMarks(ctx, state, marks, palette);
  // Smoke tests read the arrows: left|right|warned.
  let warned = 0, left = 0;
  for (const mark of marks) { if (mark.warn) warned++; if (mark.side < 0) left++; }
  const edgeData = `${left}|${marks.length - left}|${warned}`;
  if (canvas.dataset.edge !== edgeData) canvas.dataset.edge = edgeData;
  const clear = drawBossBar(ctx, state, palette, layout?.hudBottom ?? 0, canvas);
  drawEnergyGain(ctx, state, lerp(player.f, player.old)[0], palette);
  drawShrug(ctx, state, palette);

  // Banners keep below the HUD and the boss bar (their top edge sits about 30 px above the first line).
  const shift = Math.max(0, clear + 8 - (BANNER_Y - 30));
  const banner = (text: string, y: number, font: string, halo: number) => {
    y += shift;
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

/** Topmost bar position; the bar moves further down when the DOM HUD reaches lower (narrow windows). */
const BOSS_BAR_Y = 98;
/** Room between the HUD's bottom edge and the bar (its label sits above the bar). */
const BOSS_BAR_GAP = 22;

/** Baseline of the first PAUSE / game over banner line when nothing is in the way. */
const BANNER_Y = 150;

/** Health bar of a living miniboss at the top of the arena, below the DOM HUD. Returns the lowest y it or the HUD occupies. */
function drawBossBar(ctx: CanvasRenderingContext2D, state: SurvivalState, palette: Palette, hudBottom: number, canvas: HTMLCanvasElement): number {
  const boss = state.enemies.find(e => e.boss > 0 && !e.dead);
  const y = Math.max(BOSS_BAR_Y, Math.ceil(hudBottom) + BOSS_BAR_GAP), width = 300, x = 480 - width / 2;
  // Smoke tests check the bar (label included) against the HUD: x|top|width|height in canvas pixels.
  const barData = boss ? `${x - 3}|${y - 18}|${width + 6}|${18 + 14}` : '';
  if ((canvas.dataset.bossBar ?? '') !== barData) { if (barData) canvas.dataset.bossBar = barData; else delete canvas.dataset.bossBar; }
  if (!boss) return hudBottom;
  const ratio = Math.max(0, Math.min(1, boss.fighter.hp / boss.maxHp));
  ctx.save();
  ctx.fillStyle = palette.arena; ctx.globalAlpha = .65; ctx.fillRect(x - 3, y - 3, width + 6, 16);
  ctx.globalAlpha = 1; ctx.fillStyle = enemyColor(boss); ctx.fillRect(x, y, width * ratio, 10);
  ctx.strokeStyle = palette.text; ctx.lineWidth = 1; ctx.strokeRect(x - .5, y - .5, width + 1, 11);
  ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center'; ctx.lineJoin = 'round'; ctx.strokeStyle = palette.arena; ctx.lineWidth = 4;
  const label = t('survival.bossBar', { n: boss.boss });
  ctx.strokeText(label, 480, y - 7); ctx.fillStyle = palette.text; ctx.fillText(label, 480, y - 7);
  ctx.restore();
  return y + 14;
}

/** Floating "+N" above the player for a short time after an energy gain. */
function drawEnergyGain(ctx: CanvasRenderingContext2D, state: SurvivalState, x: number, palette: Palette): void {
  const age = state.frame - state.energy.lastFrame, life = 50;
  if (age < 0 || age > life) return;
  const rise = age * .5;
  ctx.save();
  ctx.globalAlpha = Math.min(1, (life - age) / 20);
  ctx.font = state.energy.boss ? 'bold 20px Arial' : 'bold 13px Arial'; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
  ctx.strokeStyle = palette.arena; ctx.lineWidth = 4; ctx.fillStyle = palette.special;
  ctx.strokeText(`+${state.energy.last}`, x, ground - 150 - rise); ctx.fillText(`+${state.energy.last}`, x, ground - 150 - rise);
  ctx.restore();
}

/** "Shrugged off" above a miniboss that just shook off a throw attempt. */
function drawShrug(ctx: CanvasRenderingContext2D, state: SurvivalState, palette: Palette): void {
  const age = state.frame - state.shrug.frame, life = 40;
  const boss = state.enemies.find(e => e.uid === state.shrug.uid);
  if (age < 0 || age > life || !boss) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, (life - age) / 15);
  ctx.font = 'bold 13px Arial'; ctx.textAlign = 'center'; ctx.lineJoin = 'round';
  ctx.strokeStyle = palette.arena; ctx.lineWidth = 4; ctx.fillStyle = palette.muted;
  const text = t('survival.shrug'), x = boss.fighter.x / U, y = ground - 165 - age * .4;
  ctx.strokeText(text, x, y); ctx.fillText(text, x, y);
  ctx.restore();
}

function blinkHidden(enemy: Enemy, state: SurvivalState): boolean {
  const left = state.config.enemies.koRemoveFrames - enemy.koFrames;
  return left < BLINK_FRAMES && Math.floor(left / 3) % 2 === 0;
}

/** Arrow height above the ground (above the heads, so a cut figure never hides it) and spacing of stacked arrows. */
const EDGE_Y = 150, EDGE_STACK = 26;

/** Arrows at the canvas edge for enemies outside it; a warned back attacker's arrow pulses with a "!". */
function drawEdgeMarks(ctx: CanvasRenderingContext2D, state: SurvivalState, marks: readonly EdgeMark[], palette: Palette): void {
  if (!marks.length) return;
  ctx.save(); ctx.lineJoin = 'round';
  for (const mark of marks) {
    const enemy = state.enemies.find(e => e.uid === mark.uid);
    if (!enemy) continue;
    const pulse = mark.warn ? 1 + .2 * Math.abs(Math.sin(state.frame * .35)) : 1;
    const size = (mark.boss ? 1.35 : 1) * pulse, color = mark.warn ? palette.revenge : enemyColor(enemy);
    const x = mark.side < 0 ? 4 : 956, y = ground - EDGE_Y - mark.slot * EDGE_STACK;
    ctx.save(); ctx.translate(x, y); ctx.scale(-mark.side * size, size);
    // Badge in the arena colour with a text-coloured rim, the arrow in the enemy's colour;
    // its tip touches the edge and points out of the canvas towards the enemy.
    ctx.beginPath(); ctx.roundRect(-2, -10, 22, 20, 5);
    ctx.globalAlpha = .82; ctx.fillStyle = palette.arena; ctx.fill();
    ctx.globalAlpha = 1; ctx.strokeStyle = mark.warn ? palette.revenge : palette.text; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(1, 0); ctx.lineTo(15, -7); ctx.lineTo(15, 7); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.restore();
    if (mark.warn) {
      ctx.font = 'bold 18px Arial'; ctx.textAlign = 'center';
      const tx = x - mark.side * (30 * size), ty = y + 7;
      ctx.strokeStyle = palette.arena; ctx.lineWidth = 4; ctx.strokeText('!', tx, ty);
      ctx.fillStyle = palette.revenge; ctx.fillText('!', tx, ty);
    }
  }
  ctx.restore();
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
