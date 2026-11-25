import rules from '../data/rules.json';
import type { FighterState } from '../simulation/types';
import type { SurvivalConfig, UpgradeId } from './config';
import { random } from './random';
import type { SurvivalState } from './state';

/*
 * Roguelite upgrades of a survival run (values: config.ts `upgrades`).
 *
 * After a miniboss fell and its cleanup phase is over, the run pauses and the
 * player picks one of up to three upgrades. `stepSurvival` does nothing while
 * an offer is open. The cards come from the run's own seeded stream
 * (`UpgradeState.seed`, derived from the run seed), separate from the spawn
 * stream: the same seed always offers the same cards, and the picks never
 * change which enemies come.
 *
 * Every effect stays in the survival layer; the versus engine is untouched:
 *  - fighter fields of the player (damage scale, Revenge/Special gains,
 *    stability) are written by `applyUpgrades`, derived from the stacks only;
 *  - energy (full energy, gain), the chip refund of blocked hits and the back
 *    warning are read by state.ts and the director through the helpers below.
 */

export interface UpgradeState {
  /** Picks per upgrade. */
  stacks: Record<UpgradeId, number>;
  /** Every pick in order (end banner). */
  picks: UpgradeId[];
  /** The open choice, null when none. */
  offer: UpgradeId[] | null;
  /** Frame from which the next choice is due (a boss fell), null when none is pending. */
  dueAt: number | null;
  /** Own seeded stream of the card draws. */
  seed: number;
  /** Frame of the last pick (director: short attack pause), null before the first. */
  resumedAt: number | null;
}

export const upgradeIds = (config: SurvivalConfig): UpgradeId[] => Object.keys(config.upgrades.effects) as UpgradeId[];

export function createUpgrades(config: SurvivalConfig, seed: number): UpgradeState {
  return {
    stacks: Object.fromEntries(upgradeIds(config).map(id => [id, 0])) as Record<UpgradeId, number>,
    picks: [], offer: null, dueAt: null, seed: (seed ^ 0x7a3c5e1) | 0, resumedAt: null,
  };
}

type UpgradeView = Pick<SurvivalState, 'config' | 'upgrades'>;
const stacksOf = (state: UpgradeView, id: UpgradeId): number => state.upgrades.stacks[id];
const effects = (state: UpgradeView) => state.config.upgrades.effects;

/** Upgrades below their stack limit, in config order. */
export function availableUpgrades(state: UpgradeView): UpgradeId[] {
  return upgradeIds(state.config).filter(id => stacksOf(state, id) < state.config.upgrades.effects[id].max);
}

/** Draws up to `cards` different upgrades that are still below their limit. */
export function drawOffer(state: UpgradeView): UpgradeId[] {
  const pool = availableUpgrades(state), cards: UpgradeId[] = [];
  while (cards.length < state.config.upgrades.cards && pool.length) cards.push(pool.splice(Math.floor(random(state.upgrades) * pool.length), 1)[0]);
  return cards;
}

// ------------------------------------------------------------- effects ---

/** Full energy of the player (hit and KO gains stop here). */
export function playerMaxHp(state: UpgradeView): number {
  return state.config.player.hp + effects(state).maxEnergy.amount * stacksOf(state, 'maxEnergy');
}
/** Upper limit of the boss bonus; grows with full energy. */
export function reserveCap(state: UpgradeView): number {
  return state.config.energy.reserveCap + effects(state).maxEnergy.amount * stacksOf(state, 'maxEnergy');
}
/** Factor on every energy gain. */
export function gainMultiplier(state: UpgradeView): number {
  return 1 + effects(state).energyGain.percent * stacksOf(state, 'energyGain') / 100;
}
/** Extra frames of the back attackers' warning. */
export function backWarningBonus(state: UpgradeView): number {
  return effects(state).backWarning.frames * stacksOf(state, 'backWarning');
}
/** Energy given back of the chip damage of one blocked hit. */
export function guardRefund(state: UpgradeView, chip: number): number {
  return Math.max(0, Math.min(chip, Math.round(chip * effects(state).guard.chipPercent * stacksOf(state, 'guard') / 100)));
}
/** Energy gain (before decay) of one blocked hit. */
export function guardEnergy(state: UpgradeView): number {
  return effects(state).guard.energy * stacksOf(state, 'guard');
}

const scaled = (base: number, percent: number, n: number): number => Math.round(base * (100 + percent * n) / 100);

/** Writes the fighter-side effects onto the player. Idempotent: derived from the stacks only. */
export function applyUpgrades(state: SurvivalState): void {
  const p = state.player, e = effects(state), s = state.upgrades.stacks;
  p.damageScalePermille = scaled(rules.damageScaleUnit, e.damage.percent, s.damage);
  p.resources.revenge.gainPerHit = scaled(rules.resources.revenge.gainPerHit, e.revenge.percent, s.revenge);
  p.resources.special.gainPerHit = scaled(rules.resources.special.gainPerHit, e.special.percent, s.special);
  p.resources.special.gainPerBlock = scaled(rules.resources.special.gainPerBlock, e.special.percent, s.special);
  if (s.stability) p.stability = rules.hitStrength.defaultStability + e.stability.amount * s.stability;
  else delete p.stability;
}

// ---------------------------------------------------------------- flow ---

/** A miniboss fell: the choice is due once its cleanup phase is over. */
export function bossFell(state: SurvivalState): void {
  const c = state.config;
  if (c.upgrades.enabled) state.upgrades.dueAt = state.frame + c.duel.cleanupFrames + c.upgrades.delayFrames;
}

const FREE_STATES: readonly FighterState[] = ['Idle', 'Walk', 'Run', 'Crouch', 'CrouchWalk'];

/**
 * Opens a due choice at the end of a step: as soon as the player stands free,
 * at the latest `maxWaitFrames` after it became due. Nothing is offered when
 * every upgrade is maxed.
 */
export function offerStep(state: SurvivalState): void {
  const u = state.upgrades, p = state.player;
  if (u.dueAt === null || state.over || state.frame < u.dueAt) return;
  const free = FREE_STATES.includes(p.state) && p.y === 0 && !state.turn && state.hitstop === 0;
  if (!free && state.frame < u.dueAt + state.config.upgrades.maxWaitFrames) return;
  u.dueAt = null;
  const cards = drawOffer(state);
  if (cards.length) u.offer = cards;
}

/**
 * Takes card `index` (0-based) of the open choice and resumes the run.
 * Returns the picked upgrade, null when no offer is open or the index is invalid.
 */
export function chooseUpgrade(state: SurvivalState, index: number): UpgradeId | null {
  const u = state.upgrades, id = u.offer?.[index];
  if (!id) return null;
  u.stacks[id]++; u.picks.push(id); u.offer = null; u.resumedAt = state.frame;
  applyUpgrades(state);
  if (id === 'maxEnergy') {
    const p = state.player, before = p.hp;
    p.hp = Math.max(p.hp, Math.min(playerMaxHp(state), p.hp + effects(state).maxEnergy.heal));
    const real = p.hp - before, log = state.energy;
    if (real > 0) { log.last = real; log.lastFrame = state.frame; log.total += real; log.boss = false; }
  }
  return id;
}

/** Picks per upgrade in config order, maxed or not, without the unpicked ones. */
export function activeUpgrades(state: UpgradeView): { id: UpgradeId; stacks: number; max: number }[] {
  return upgradeIds(state.config).filter(id => stacksOf(state, id) > 0)
    .map(id => ({ id, stacks: stacksOf(state, id), max: state.config.upgrades.effects[id].max }));
}
