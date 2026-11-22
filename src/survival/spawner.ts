import type { EnemyTier, EnemyType, EnemyTypeId, SurvivalConfig } from './config';
import type { SurvivalState } from './state';

/*
 * Spawn side of the director: which enemy type comes next, how strong the next
 * miniboss is. Pure functions on the survival state; the only randomness is
 * the state's own seeded stream (`random`, passed in), so runs stay
 * deterministic. All numbers live in config.ts (`types`, `budget`, `boss`).
 */

/** Everything a spawned enemy needs (an archetype or a boss of a given number). */
export interface EnemySpec extends EnemyType {
  /** Archetype id, `boss` for minibosses. */
  id: string;
  /** 0 for regular enemies, otherwise the number of the boss (1 = first). */
  boss: number;
}

export const TIERS: readonly EnemyTier[] = ['light', 'medium', 'heavy'];

export function typeSpec(config: SurvivalConfig, id: EnemyTypeId): EnemySpec {
  return { ...config.types[id], id, boss: 0 };
}

/** Miniboss number `n` (1-based): base values plus `boss.growth` per further boss. */
export function bossSpec(config: SurvivalConfig, n: number): EnemySpec {
  const b = config.boss, g = b.growth, more = Math.max(0, n - 1);
  return {
    id: 'boss', boss: n, tier: 'heavy', cost: 0,
    hp: Math.round(b.hp * (1 + g.hp * more)),
    poise: Math.round(b.poise * (1 + g.poise * more)),
    damagePermille: Math.round(b.damagePermille * (1 + g.damage * more)),
    stability: b.stability,
    difficulty: b.difficulty[Math.min(n, b.difficulty.length) - 1] ?? b.difficulty[b.difficulty.length - 1],
    aggression: Math.min(b.maxAggression, b.aggression + g.aggression * more),
    reactionFrames: Math.max(b.minReactionFrames, b.reactionFrames + g.reactionFrames * more),
    killEnergy: b.killEnergy,
  };
}

/** Difficulty budget after `frames` of run time. */
export function budgetAt(config: SurvivalConfig, frames: number, hz: number): number {
  return Math.min(config.budget.cap, config.budget.start + config.budget.growthPerSecond * frames / hz);
}

export const secondsOf = (frames: number, hz: number): number => frames / hz;

/** Gain factor for energy rewards: shrinks slowly with the run time, never below the floor. */
export function gainFactor(config: SurvivalConfig, frames: number, hz: number): number {
  const d = config.energy.decay;
  return Math.max(d.floor, 1 - d.perMinute * frames / hz / 60);
}

export interface PickOptions {
  /** Wave enemies: mostly light, ignores the budget and the heavy tier. */
  wave?: boolean;
}

/**
 * Next regular enemy type.
 *  1. Candidates: types that still fit into the budget (cost of everything
 *     alive counted), whose tier already takes part at this run time; at most
 *     `maxHeavy` heavy ones.
 *  2. Mix guarantee: a tier below its `minPresent` is picked from first, even
 *     if that overshoots the budget a little.
 *  3. Weighted pick: tier weights grow with the run time; the tier of the
 *     enemy that fell last is `sameTierPreference` times as likely, so the
 *     mix stays balanced.
 */
export function pickType(state: SurvivalState, rand: () => number, hz: number, options: PickOptions = {}): EnemyTypeId {
  const config = state.config, b = config.budget, seconds = secondsOf(state.survivedFrames, hz);
  const living = state.enemies.filter(e => !e.dead && e.boss === 0);
  const ids = Object.keys(config.types) as EnemyTypeId[];
  const remaining = budgetAt(config, state.survivedFrames, hz) - living.reduce((sum, e) => sum + e.cost, 0);
  const count = (tier: EnemyTier) => living.filter(e => e.tier === tier).length;
  const fits = (id: EnemyTypeId) => {
    const t = config.types[id];
    if (seconds < b.tierFromSeconds[t.tier]) return false;
    if (t.tier === 'heavy' && count('heavy') >= b.maxHeavy) return false;
    if (options.wave) return t.tier !== 'heavy';
    return t.cost <= remaining;
  };
  let candidates = ids.filter(fits);
  // The cheapest light type is always allowed, even with an exhausted budget.
  if (!candidates.length) candidates = ids.filter(id => config.types[id].tier === 'light').sort((x, y) => config.types[x].cost - config.types[y].cost).slice(0, 1);
  if (!options.wave) {
    // The guarantee may overshoot the budget a little: a missing tier is always filled (cheapest type first in the pool).
    const missing = TIERS.find(tier => count(tier) < b.minPresent[tier] && seconds >= b.tierFromSeconds[tier]);
    if (missing) candidates = ids.filter(id => config.types[id].tier === missing && (missing !== 'heavy' || count('heavy') < b.maxHeavy));
  }
  const minutes = seconds / 60;
  const weight = (id: EnemyTypeId) => {
    const tier = config.types[id].tier;
    let w = b.weights[tier] + b.weightGrowthPerMinute[tier] * minutes;
    if (options.wave) w = tier === 'heavy' ? 0 : config.waves.weights[tier];
    if (!options.wave && state.flow.lastFallen === tier) w *= b.sameTierPreference;
    // Several types of a tier share its weight.
    return w / ids.filter(other => config.types[other].tier === tier && candidates.includes(other)).length;
  };
  const total = candidates.reduce((sum, id) => sum + weight(id), 0);
  let roll = rand() * total;
  for (const id of candidates) { roll -= weight(id); if (roll < 0) return id; }
  return candidates[candidates.length - 1];
}
