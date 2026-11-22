import type { GameState } from '../simulation/types';

/*
 * "Bar full" feedback (Revenge / Special). Presentation only: derived from two
 * consecutive game states, never written into a GameState, so it has no
 * influence on DATA_HASH or replays and fires identically in replays and the
 * CPU demo. A bar that is already full (for example at a round start, where
 * resources carry over) never fires again; only the transition below → full.
 */

export const RESOURCE_NAMES = ['revenge', 'special'] as const;
export type ResourceName = typeof RESOURCE_NAMES[number];
/** Steps between two bursts that start in the same simulation step. */
export const READY_STAGGER_STEPS = 6;

export interface ResourceFill { fighter: number; resource: ResourceName; /** Presentation delay in simulation steps. */ delay: number }

/** True while the bar is completely full (HUD ready state). */
export function isResourceFull(game: GameState, fighter: number, resource: ResourceName): boolean {
  const value = game.fighters[fighter]?.resources[resource];
  return !!value && value.current >= value.max;
}

/**
 * Bars that became full in this step: `previous.current < max` and
 * `current === max`, per fighter and per bar. Several fills of one step are
 * staggered by READY_STAGGER_STEPS in a fixed order (P1 before P2, Revenge
 * before Special), so overlapping bursts and sounds stay distinguishable.
 */
export function newResourceFills(game: GameState, previous: GameState): ResourceFill[] {
  const fills: ResourceFill[] = [];
  for (const fighter of game.fighters) {
    const before = previous.fighters[fighter.id];
    if (!before) continue;
    for (const resource of RESOURCE_NAMES) {
      const now = fighter.resources[resource], then = before.resources[resource];
      if (now.current === now.max && then.current < then.max) fills.push({ fighter: fighter.id, resource, delay: fills.length * READY_STAGGER_STEPS });
    }
  }
  return fills;
}
