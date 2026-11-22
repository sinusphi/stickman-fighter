import rules from '../data/rules.json';
import { captureInput } from '../input/commands';
import { buttonBit, neutralInput, type RawInput } from '../input/types';
import { createFighter, createRound } from '../simulation/factory';
import { moveFighter } from '../simulation/movement';
import { pushbox, resolvePushboxes } from '../simulation/collision';
import { advanceAttack, resolveCombat, startAttack, standingHoldEligible } from '../simulation/combat';
import type { Facing, Fighter, GameState } from '../simulation/types';
import { SURVIVAL, type SurvivalConfig } from './config';

/*
 * Survival simulation: one player against a changing crowd of enemies.
 *
 * The versus engine is strictly two-fighter. Instead of generalising it, every
 * enemy carries a `pair` view – an ordinary GameState whose fighters are the
 * shared player object and this enemy – and the existing per-fighter and
 * per-pair functions (movement, attacks, pushboxes, combat) run unchanged on
 * it. Enemies never hit each other. Deterministic like the versus engine:
 * integer subpixels, own seeded random stream, no clock.
 *
 * Player facing is fixed; only a turn (double tap backwards) changes it.
 * Enemies always face the player. Throws are not part of survival yet.
 */

export interface Enemy {
  uid: number;
  fighter: Fighter;
  /** Two-fighter view [player, enemy] for the shared combat code and the CPU. */
  pair: GameState;
  /** The player's hit targets against this enemy during the player's current attack. */
  playerHits: string[];
  /** Still walking in from outside the arena: no collision, no combat. */
  entering: boolean;
  /** Counted as killed (once, when it went KO). */
  dead: boolean;
  koFrames: number;
  /** Presentation only, written by the session: frames left of the back-attack warning. */
  warn: number;
}
export interface TurnState { frame: number; from: Facing }
export interface SurvivalState {
  frame: number;
  combatFrame: number;
  seed: number;
  player: Fighter;
  enemies: Enemy[];
  nextUid: number;
  spawnTimer: number;
  survivedFrames: number;
  kills: number;
  over: boolean;
  hitstop: number;
  turn: TurnState | null;
  /** Raw left/right of the previous step and frame of the last free back tap (double-tap detection). */
  tap: { left: boolean; right: boolean; lastBack: number };
  /** Number of completed turns (presentation and director). */
  turns: number;
  playerAttackId: number;
  inputConfig: GameState['inputConfig'];
  /** Enemy the player hit last (HUD focus). */
  focus: number | null;
  config: SurvivalConfig;
}

const U = rules.unit;
const THROW_BIT = buttonBit('THROW');
/** States in which the player may turn: standing free or walking. */
export const TURNABLE_STATES: readonly Fighter['state'][] = ['Idle', 'Walk'];

/** Mulberry32 on the state's seed; the only randomness of the simulation. */
export function random(state: { seed: number }): number {
  state.seed = (state.seed + 0x6d2b79f5) | 0;
  let t = state.seed;
  t = Math.imul(t ^ t >>> 15, t | 1);
  t ^= t + Math.imul(t ^ t >>> 7, t | 61);
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}

export function createSurvival(seed = 1, inputConfig?: GameState['inputConfig'], config: SurvivalConfig = SURVIVAL): SurvivalState {
  const player = createFighter(0);
  player.x = Math.round(rules.stageWidth / 2); player.hp = config.player.hp;
  player.facing = player.attackFacing = 1;
  return {
    frame: 0, combatFrame: 0, seed: seed | 0, player, enemies: [], nextUid: 1,
    spawnTimer: config.enemies.firstSpawnFrames, survivedFrames: 0, kills: 0, over: false, hitstop: 0,
    turn: null, tap: { left: false, right: false, lastBack: -Infinity }, turns: 0, playerAttackId: player.attackId,
    inputConfig: structuredClone(inputConfig ?? { socd: { horizontal: 'neutral', vertical: 'positive' }, bufferFrames: rules.bufferFrames }),
    focus: null, config,
  };
}

function createPair(state: SurvivalState, fighter: Fighter): GameState {
  return {
    schemaVersion: 2, frame: state.frame, combatFrame: state.combatFrame, fighters: [state.player, fighter],
    inputConfig: { ...state.inputConfig, autoBlock: [state.inputConfig.autoBlock?.[0] ?? false, false] },
    hitstop: 0, lastContact: null, measurements: [], round: createRound(),
    training: { enabled: false, dummy: 'stand' }, noRearGuard: true,
  };
}

/** True when the enemy stands on the side the player is looking at. */
export function inFront(player: Fighter, enemy: Fighter): boolean {
  return enemy.x === player.x || Math.sign(enemy.x - player.x) === player.facing;
}
export const alive = (e: Enemy): boolean => !e.dead && e.fighter.state !== 'KO';

export function spawnEnemy(state: SurvivalState, side?: -1 | 1): Enemy {
  const c = state.config.enemies, p = state.player;
  if (!side) {
    const left = state.enemies.filter(e => alive(e) && e.fighter.x < p.x).length;
    const right = state.enemies.filter(e => alive(e) && e.fighter.x >= p.x).length;
    side = left < right ? -1 : right < left ? 1 : random(state) < .5 ? -1 : 1;
  }
  const f = createFighter(1);
  f.x = side < 0 ? -c.spawnOffset * U : rules.stageWidth + c.spawnOffset * U;
  f.facing = f.attackFacing = side < 0 ? 1 : -1;
  f.hp = c.hp; f.damageScalePermille = Math.round(rules.damageScaleUnit * c.damagePermille / 1000); f.stability = c.stability;
  const enemy: Enemy = { uid: state.nextUid++, fighter: f, pair: createPair(state, f), playerHits: [], entering: true, dead: false, koFrames: 0, warn: 0 };
  state.enemies.push(enemy);
  return enemy;
}

/**
 * Double tap against the current facing. Taps only count while the player is
 * free (standing or walking); any attack, stun or jump in between cancels the
 * first tap. A tap together with a button press never turns, so a back
 * direction can always open a command move.
 */
function detectTurn(state: SurvivalState, raw: RawInput): boolean {
  const p = state.player, tap = state.tap;
  const back = p.facing === 1 ? raw.left : raw.right, wasBack = p.facing === 1 ? tap.left : tap.right;
  tap.left = raw.left; tap.right = raw.right;
  const free = TURNABLE_STATES.includes(p.state) && p.y === 0 && !state.turn;
  if (!free || (raw.buttons & ~p.input.previous.buttons) || raw.taps) { tap.lastBack = -Infinity; return false; }
  if (!back || wasBack) return false;
  if (state.frame - tap.lastBack <= state.config.turn.doubleTapFrames) { tap.lastBack = -Infinity; return true; }
  tap.lastBack = state.frame;
  return false;
}

function advanceTurn(state: SurvivalState): void {
  const turn = state.turn, p = state.player;
  if (!turn) return;
  const target: Facing = turn.from === 1 ? -1 : 1;
  // Interrupted (hit, knocked down): the turn completes at once.
  if (!TURNABLE_STATES.includes(p.state)) { p.facing = p.attackFacing = target; state.turn = null; state.turns++; return; }
  turn.frame++;
  if (turn.frame >= Math.ceil(state.config.turn.frames / 2)) p.facing = p.attackFacing = target;
  if (turn.frame >= state.config.turn.frames) { state.turn = null; state.turns++; }
}

function faceEnemies(state: SurvivalState): void {
  const p = state.player;
  for (const { fighter: f } of state.enemies) if (f.x !== p.x && f.state !== 'KO') f.facing = f.x < p.x ? 1 : -1;
}

function settle(state: SurvivalState): void {
  const neutral = neutralInput();
  for (const f of [state.player, ...state.enemies.map(e => e.fighter)]) {
    if (f.state === 'KO') { moveFighter(f, true); continue; }
    captureInput(f.input, neutral, f.facing, state.frame, state.combatFrame, state.inputConfig.socd, state.inputConfig.bufferFrames);
    f.input.pending = null;
    advanceAttack(f); moveFighter(f, true);
  }
}

function insideArena(f: Fighter): boolean {
  const box = pushbox(f);
  return box.x >= 0 && box.x + box.width <= rules.stageWidth;
}

function resolveBodies(state: SurvivalState): void {
  const p = state.player;
  const solid = state.enemies.filter(e => !e.entering && e.fighter.state !== 'KO').map(e => e.fighter).sort((a, b) => a.x - b.x);
  for (let i = 1; i < solid.length; i++) resolvePushboxes([solid[i - 1], solid[i]]);
  for (const f of solid) resolvePushboxes([p, f]);
}

/**
 * One survival step. `enemyInputs` is aligned with `state.enemies` (missing
 * entries mean neutral input). Mirrors simulation/state.step: inputs are
 * captured during hitstop, everything else waits for it to end.
 */
export function stepSurvival(state: SurvivalState, playerRaw: RawInput, enemyInputs: readonly RawInput[] = []): void {
  const p = state.player, c = state.config;
  if (state.over) {
    settle(state); state.frame++; state.combatFrame++;
    removeFallen(state);
    return;
  }
  // Throws are not part of survival yet.
  const raw: RawInput = { ...playerRaw, buttons: playerRaw.buttons & ~THROW_BIT, ...(playerRaw.taps !== undefined ? { taps: playerRaw.taps & ~THROW_BIT } : {}) };
  if (detectTurn(state, raw)) state.turn = { frame: 0, from: p.facing };
  faceEnemies(state);
  captureInput(p.input, raw, p.facing, state.frame, state.combatFrame, state.inputConfig.socd, state.inputConfig.bufferFrames);
  state.enemies.forEach((e, i) => {
    const input = enemyInputs[i] ?? neutralInput();
    captureInput(e.fighter.input, { ...input, buttons: input.buttons & ~THROW_BIT }, e.fighter.facing, state.frame, state.combatFrame, state.inputConfig.socd, state.inputConfig.bufferFrames);
  });
  state.frame++;
  for (const e of state.enemies) { e.pair.frame = state.frame; e.pair.combatFrame = state.combatFrame; e.pair.hitstop = state.hitstop; }
  if (state.hitstop > 0) { state.hitstop--; return; }

  // While turning the player neither walks nor attacks.
  if (state.turn) { p.input.current.direction = 5; p.input.pending = null; }

  const fighters = [p, ...state.enemies.map(e => e.fighter)];
  const holdEligible = fighters.map(standingHoldEligible);
  for (const f of fighters) { advanceAttack(f); moveFighter(f); }
  advanceTurn(state);
  for (const [i, f] of fighters.entries()) {
    const enemy = i > 0 ? state.enemies[i - 1] : undefined;
    if (enemy?.entering) { f.input.pending = null; continue; }
    startAttack(f, state.combatFrame, holdEligible[i]);
  }
  for (const e of state.enemies) if (e.entering && insideArena(e.fighter)) e.entering = false;
  resolveBodies(state);

  // Combat per pair. The player's hit targets are kept per enemy, so one swing can hit several.
  if (p.attackId !== state.playerAttackId) { state.playerAttackId = p.attackId; for (const e of state.enemies) e.playerHits = []; }
  // KO'd enemies lie as scenery: no pushbox, no contact.
  const order = state.enemies.filter(e => !e.entering && !e.dead).sort((a, b) => Math.abs(a.fighter.x - p.x) - Math.abs(b.fighter.x - p.x));
  for (const e of order) {
    const hpBefore = e.fighter.hp;
    p.hitTargets = e.playerHits;
    e.pair.hitstop = 0;
    resolveCombat(e.pair);
    state.hitstop = Math.max(state.hitstop, e.pair.hitstop);
    if (e.fighter.hp < hpBefore) state.focus = e.uid;
  }
  p.hitTargets = [];

  for (const e of state.enemies) if (!e.dead && e.fighter.state === 'KO') { e.dead = true; state.kills++; }
  removeFallen(state);
  if (p.state === 'KO' || p.hp === 0) state.over = true;
  else state.survivedFrames++;

  if (state.spawnTimer > 0) state.spawnTimer--;
  if (!state.over && state.spawnTimer === 0 && state.enemies.filter(alive).length < c.enemies.max) {
    spawnEnemy(state);
    state.spawnTimer = c.enemies.spawnIntervalFrames;
  }
  state.combatFrame++;
}

function removeFallen(state: SurvivalState): void {
  for (const e of state.enemies) if (e.dead) e.koFrames++;
  state.enemies = state.enemies.filter(e => !e.dead || e.koFrames < state.config.enemies.koRemoveFrames);
  if (state.focus !== null && !state.enemies.some(e => e.uid === state.focus)) state.focus = null;
}

export function snapshotSurvival(state: SurvivalState): SurvivalState {
  // structuredClone keeps the shared player object shared between all pair views.
  return structuredClone(state);
}

/** Survived time as m:ss.cc. */
export function formatSurvival(frames: number): string {
  const hundredths = Math.floor(frames * 100 / rules.hz), seconds = Math.floor(hundredths / 100);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}.${String(hundredths % 100).padStart(2, '0')}`;
}
