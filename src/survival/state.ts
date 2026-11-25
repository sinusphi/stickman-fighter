import rules from '../data/rules.json';
import { MOVES } from '../data/schema';
import { captureInput } from '../input/commands';
import { buttonBit, neutralInput, type RawInput } from '../input/types';
import { createFighter, createRound } from '../simulation/factory';
import { moveFighter, transition } from '../simulation/movement';
import { pushbox, resolvePushboxes } from '../simulation/collision';
import { advanceAttack, resolveCombat, startAttack, standingHoldEligible } from '../simulation/combat';
import { advanceThrows, attemptAtGrab, inGrabRange, isThrowable, resolveThrows } from '../simulation/throws';
import type { Facing, Fighter, GameState } from '../simulation/types';
import { SURVIVAL, type EnemyTier, type SurvivalConfig } from './config';
import { bossSpec, gainFactor, pickType, typeSpec, type EnemySpec } from './spawner';

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
 * Enemies always face the player.
 *
 * Throws: only the player throws (the enemies' THROW button is masked, the
 * director never allows a throw move). The versus throw code runs per pair:
 * the closest enemy in grab range decides. Enemies in hitstun can be grabbed
 * as well (survival only), a miniboss shrugs every throw off (the attempt
 * whiffs, `shrug` records it for the presentation).
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
  /** Archetype id (`boss` for minibosses) and tier. */
  archetype: string;
  tier: EnemyTier;
  /** 0 for regular enemies, otherwise the boss number. */
  boss: number;
  /** Starting energy (HUD bar) and the director budget the enemy occupies. */
  maxHp: number;
  cost: number;
  /** CPU tuning of the archetype (read by the pilot). */
  difficulty: 'easy' | 'medium' | 'hard';
  aggression: number;
  reactionFrames: number;
  /** Energy the player gets for the KO. */
  killEnergy: number;
  /** Stagger: the enemy falls when `poise` reaches `poiseMax` (see config `stagger`). */
  poise: number;
  poiseMax: number;
  /** Frame of the last landed hit, and hits in the current combo (hits during hitstun). */
  hitFrame: number;
  chain: number;
  /** Presentation only, written by the session: frames left of the back-attack warning. */
  warn: number;
}
/** Boss, wave and mix bookkeeping of the director's spawn side. */
export interface SpawnFlow {
  /** Frames until the next boss; only runs while no boss is around, restarts when one has gone. */
  bossTimer: number;
  /** Bosses spawned so far. */
  bosses: number;
  /** Frame the last boss fell (director: cleanup phase), null before the first. */
  bossDown: number | null;
  /** Tier of the regular enemy that fell last, consumed by the next pick. */
  lastFallen: EnemyTier | null;
  waveTimer: number;
  waves: number;
  waveLeft: number;
  waveGap: number;
}
/** Energy rewards: total so far and the latest gain (floating "+N"). */
export interface EnergyLog { total: number; lastFrame: number; last: number; boss: boolean }
export interface TurnState { frame: number; from: Facing }
/** Throw attempts a miniboss shrugged off: running count, frame and enemy of the latest. */
export interface ShrugLog { count: number; frame: number; uid: number }
export interface SurvivalState {
  frame: number;
  combatFrame: number;
  seed: number;
  player: Fighter;
  enemies: Enemy[];
  nextUid: number;
  spawnTimer: number;
  flow: SpawnFlow;
  energy: EnergyLog;
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
  shrug: ShrugLog;
  config: SurvivalConfig;
}

const U = rules.unit;
const THROW_BIT = buttonBit('THROW');
/** States in which the player may turn: standing free or walking. */
export const TURNABLE_STATES: readonly Fighter['state'][] = ['Idle', 'Walk'];

/** Survival grab rule: everything a versus throw may seize, plus enemies in hitstun on the ground. */
export function survivalGrabbable(f: Fighter): boolean {
  return isThrowable(f) || (f.y === 0 && f.state === 'Hitstun');
}

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
    flow: { bossTimer: config.boss.firstFrames, bosses: 0, bossDown: null, lastFallen: null, waveTimer: config.waves.firstFrames, waves: 0, waveLeft: 0, waveGap: 0 },
    energy: { total: 0, lastFrame: -Infinity, last: 0, boss: false },
    spawnTimer: config.enemies.firstSpawnFrames, survivedFrames: 0, kills: 0, over: false, hitstop: 0,
    turn: null, tap: { left: false, right: false, lastBack: -Infinity }, turns: 0, playerAttackId: player.attackId,
    inputConfig: structuredClone(inputConfig ?? { socd: { horizontal: 'neutral', vertical: 'positive' }, bufferFrames: rules.bufferFrames }),
    focus: null, shrug: { count: 0, frame: -Infinity, uid: 0 }, config,
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

export function spawnEnemy(state: SurvivalState, side?: -1 | 1, kind: EnemySpec | keyof SurvivalConfig['types'] = 'rookie'): Enemy {
  const c = state.config.enemies, p = state.player;
  const spec = typeof kind === 'string' ? typeSpec(state.config, kind) : kind;
  if (!side) {
    const left = state.enemies.filter(e => alive(e) && e.fighter.x < p.x).length;
    const right = state.enemies.filter(e => alive(e) && e.fighter.x >= p.x).length;
    side = left < right ? -1 : right < left ? 1 : random(state) < .5 ? -1 : 1;
  }
  const f = createFighter(1);
  f.x = side < 0 ? -c.spawnOffset * U : rules.stageWidth + c.spawnOffset * U;
  f.facing = f.attackFacing = side < 0 ? 1 : -1;
  f.hp = spec.hp; f.damageScalePermille = Math.round(rules.damageScaleUnit * spec.damagePermille / 1000); f.stability = spec.stability;
  const enemy: Enemy = {
    uid: state.nextUid++, fighter: f, pair: createPair(state, f), playerHits: [], entering: true, dead: false, koFrames: 0, warn: 0,
    archetype: spec.id, tier: spec.tier, boss: spec.boss, maxHp: spec.hp, cost: spec.cost, difficulty: spec.difficulty,
    aggression: spec.aggression, reactionFrames: spec.reactionFrames, killEnergy: spec.killEnergy,
    poise: 0, poiseMax: spec.poise, hitFrame: -Infinity, chain: 0,
  };
  state.enemies.push(enemy);
  return enemy;
}

/** Heavy grounded hit: a short hop backwards, then the regular knockdown and stand-up (same as combat.ts). */
function knockDown(f: Fighter, side: number): void {
  transition(f, 'Knockdown', rules.knockdownFrames);
  f.vy = rules.hitStrength.groundKnockdownVelocity; f.vx = side * rules.hitStrength.groundKnockdownSpeed;
  f.airAttackUsed = true;
}

/** The player is in a full-bar move (command.resource) whose hits must all land. */
function committedCombo(p: Fighter): boolean {
  return p.state === 'Attack' && !!p.moveId && !!MOVES[p.moveId]?.command.resource;
}

/**
 * Stagger bookkeeping after the combat of one pair. Every landed hit fills the
 * enemy's poise (more for combo hits); a full poise knocks it down. Returns
 * the energy gain of the hit (before time decay), 0 when no hit landed.
 */
function applyHit(state: SurvivalState, e: Enemy, hpBefore: number, stateBefore: Fighter['state']): number {
  const f = e.fighter, contact = e.pair.lastContact, c = state.config;
  if (f.hp >= hpBefore || !contact || contact.blocked || contact.defender !== 1 || contact.frame !== state.combatFrame) return 0;
  e.chain = stateBefore === 'Hitstun' ? e.chain + 1 : 1;
  e.hitFrame = state.frame;
  e.poise += e.chain > 1 ? c.stagger.comboHit : c.stagger.perHit;
  if (f.state === 'Knockdown') { e.poise = 0; e.chain = 0; }
  // A full-bar combo (Revenge) is not cut short by stagger; its finisher knocks down by itself.
  else if (f.state === 'Hitstun' && e.poise >= e.poiseMax && !committedCombo(state.player)) {
    knockDown(f, Math.sign(f.x - state.player.x) || -state.player.facing); e.poise = 0; e.chain = 0;
  }
  return c.energy.perHit + (e.chain > 1 ? c.energy.perComboHit : 0);
}

/** Energy for the player. Normal gains stop at full energy, the boss bonus may go up to `energy.reserveCap`. */
function gainEnergy(state: SurvivalState, amount: number, boss: boolean): void {
  const p = state.player, c = state.config;
  if (p.hp <= 0 || p.state === 'KO') return;
  const gain = Math.round(amount * gainFactor(c, state.survivedFrames, rules.hz)), cap = boss ? c.energy.reserveCap : c.player.hp;
  const next = Math.max(p.hp, Math.min(cap, p.hp + gain)), real = next - p.hp;
  if (real <= 0) return;
  p.hp = next;
  const log = state.energy;
  log.last = state.frame - log.lastFrame <= 30 ? log.last + real : real; log.lastFrame = state.frame; log.total += real; log.boss = boss;
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
  // A throw in progress still lands, without damage once the run is over (as in versus).
  for (const e of state.enemies) advanceThrows(e.pair, false);
}

function insideArena(f: Fighter): boolean {
  const box = pushbox(f);
  return box.x >= 0 && box.x + box.width <= rules.stageWidth;
}

function resolveBodies(state: SurvivalState): void {
  const p = state.player;
  const present = state.enemies.filter(e => !e.entering && e.fighter.state !== 'KO');
  // A miniboss pushes through the crowd: spectators between it and the player must not block the duel.
  const crowd = present.filter(e => e.boss === 0).map(e => e.fighter).sort((a, b) => a.x - b.x);
  for (let i = 1; i < crowd.length; i++) resolvePushboxes([crowd[i - 1], crowd[i]]);
  for (const { fighter: f } of present) resolvePushboxes([p, f]);
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
  const raw = playerRaw;
  if (detectTurn(state, raw)) state.turn = { frame: 0, from: p.facing };
  faceEnemies(state);
  captureInput(p.input, raw, p.facing, state.frame, state.combatFrame, state.inputConfig.socd, state.inputConfig.bufferFrames);
  state.enemies.forEach((e, i) => {
    // Enemies never throw.
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
  advanceThrowsOf(state);
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
  grabStep(state, order);
  for (const e of order) {
    const hpBefore = e.fighter.hp, stateBefore = e.fighter.state;
    p.hitTargets = e.playerHits;
    e.pair.hitstop = 0;
    resolveCombat(e.pair);
    state.hitstop = Math.max(state.hitstop, e.pair.hitstop);
    if (e.fighter.hp < hpBefore) state.focus = e.uid;
    const hitGain = applyHit(state, e, hpBefore, stateBefore);
    if (hitGain) gainEnergy(state, hitGain, false);
  }
  p.hitTargets = [];

  for (const e of state.enemies) {
    if (!e.dead && e.fighter.state === 'KO') {
      e.dead = true; state.kills++;
      gainEnergy(state, e.killEnergy, e.boss > 0);
      if (e.boss) state.flow.bossDown = state.frame; else state.flow.lastFallen = e.tier;
    }
    // Stagger recovers while the enemy is left alone.
    if (e.poise > 0 && state.frame - e.hitFrame > c.stagger.recoverDelayFrames && e.fighter.state !== 'Hitstun') e.poise = Math.max(0, e.poise - c.stagger.recoverPerFrame);
    if (e.chain && e.fighter.state !== 'Hitstun' && e.fighter.state !== 'Knockdown') e.chain = 0;
  }
  removeFallen(state);
  if (p.state === 'KO' || p.hp === 0) state.over = true;
  else state.survivedFrames++;

  if (!state.over) spawnStep(state);
  state.combatFrame++;
}

/** Running throws: the victim follows the table; on the impact the hit counts like any other landed hit. */
function advanceThrowsOf(state: SurvivalState): void {
  for (const e of state.enemies) {
    if (e.fighter.state !== 'Thrown') continue;
    const hpBefore = e.fighter.hp;
    e.pair.hitstop = 0;
    advanceThrows(e.pair);
    state.hitstop = Math.max(state.hitstop, e.pair.hitstop);
    if (e.fighter.hp < hpBefore) state.focus = e.uid;
    const gain = applyHit(state, e, hpBefore, 'Thrown');
    if (gain) gainEnergy(state, gain, false);
  }
}

/**
 * Grab check of the player's throw attempt, closest enemy first. The first
 * enemy in grab range that could be seized decides: a regular enemy is thrown
 * (versus throw code on its pair), a miniboss shrugs the attempt off and it
 * whiffs with its regular recovery.
 */
function grabStep(state: SurvivalState, order: readonly Enemy[]): void {
  const p = state.player, attempt = attemptAtGrab(p);
  if (!attempt) return;
  for (const e of order) {
    if (!survivalGrabbable(e.fighter) || !inGrabRange(p, e.fighter, attempt)) continue;
    if (e.boss > 0) { state.shrug = { count: state.shrug.count + 1, frame: state.frame, uid: e.uid }; return; }
    e.pair.hitstop = 0;
    resolveThrows(e.pair, survivalGrabbable);
    state.hitstop = Math.max(state.hitstop, e.pair.hitstop);
    state.focus = e.uid;
    return;
  }
}

/**
 * Spawns of one frame: the boss when its timer ran out, small waves and the
 * regular refill. The boss timer only runs while no boss is in the arena
 * (see removeFallen); there is never more than one boss.
 */
function spawnStep(state: SurvivalState): void {
  const c = state.config, flow = state.flow, p = state.player;
  const living = state.enemies.filter(alive), bossPresent = state.enemies.some(e => e.boss > 0), bossAlive = living.some(e => e.boss > 0);
  if (!bossPresent) {
    if (flow.bossTimer > 0) flow.bossTimer--;
    if (flow.bossTimer === 0) {
      // The boss walks in on the side the player looks at: the duel starts in front.
      flow.bosses++; flow.waveLeft = 0;
      spawnEnemy(state, p.facing, bossSpec(c, flow.bosses));
      state.spawnTimer = Math.max(state.spawnTimer, c.enemies.spawnIntervalFrames);
      return;
    }
  }
  const regular = living.filter(e => e.boss === 0).length;
  const cleanup = !bossAlive && flow.bossDown !== null && state.frame - flow.bossDown < c.duel.cleanupFrames;

  // Small waves between the bosses, not right before one.
  if (!bossPresent && flow.bossTimer > c.waves.bossMarginFrames) {
    if (flow.waveLeft === 0 && flow.waveTimer > 0) flow.waveTimer--;
    if (flow.waveLeft === 0 && flow.waveTimer === 0) {
      flow.waves++; flow.waveTimer = c.waves.intervalFrames;
      flow.waveLeft = Math.min(c.waves.maxSize, Math.floor(c.waves.size + c.waves.growth * (flow.waves - 1)));
    }
  } else flow.waveLeft = 0;
  if (flow.waveLeft > 0) {
    if (flow.waveGap > 0) flow.waveGap--;
    else if (regular < c.enemies.max + c.waves.extraSlots) {
      spawnEnemy(state, undefined, pickType(state, () => random(state), rules.hz, { wave: true }));
      flow.waveLeft--; flow.waveGap = c.waves.gapFrames;
    }
    return;
  }

  if (state.spawnTimer > 0) state.spawnTimer--;
  const cap = bossAlive ? c.boss.spectators : c.enemies.max;
  if (state.spawnTimer === 0 && regular < cap) {
    const id = pickType(state, () => random(state), rules.hz);
    flow.lastFallen = null;
    spawnEnemy(state, undefined, id);
    state.spawnTimer = cleanup ? c.duel.cleanupSpawnIntervalFrames : c.enemies.spawnIntervalFrames;
  }
}

function removeFallen(state: SurvivalState): void {
  for (const e of state.enemies) if (e.dead) e.koFrames++;
  const before = state.enemies.some(e => e.boss > 0);
  state.enemies = state.enemies.filter(e => !e.dead || e.koFrames < state.config.enemies.koRemoveFrames);
  // The boss timer starts over once no boss is left in the arena (alive or lying on the floor).
  if (before && !state.enemies.some(e => e.boss > 0)) state.flow.bossTimer = state.config.boss.intervalFrames;
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
