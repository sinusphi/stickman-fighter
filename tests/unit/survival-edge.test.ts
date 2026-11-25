import { describe, expect, it } from 'vitest';
import rules from '../../src/data/rules.json';
import { EDGE_DELAY, EdgeTracker } from '../../src/render/edge-marks';
import { createSurvival, snapshotSurvival, spawnEnemy, type SurvivalState } from '../../src/survival/state';

const U = rules.unit, W = rules.stageWidth;

/** Advances only the frame counter: the tracker reads positions and frames, nothing else. */
function tick(state: SurvivalState, frames = 1): void { state.frame += frames; }

describe('survival edge arrows', () => {
  it('ignores a normal walk-in and marks an enemy that stays outside', () => {
    const state = createSurvival(3), tracker = new EdgeTracker();
    const enemy = spawnEnemy(state, -1);
    expect(enemy.fighter.x).toBeLessThan(0);
    for (let i = 0; i < EDGE_DELAY - 1; i++) { expect(tracker.update(state)).toHaveLength(0); tick(state); }
    // The default spawn offset needs fewer frames than EDGE_DELAY to bring the body centre in.
    expect(state.config.enemies.spawnOffset * U / rules.forwardSpeed).toBeLessThan(EDGE_DELAY);
    tick(state);
    expect(tracker.update(state)).toMatchObject([{ uid: enemy.uid, side: -1, slot: 0, warn: false, boss: false }]);
    // Back inside: the arrow goes away at once and the delay starts over next time.
    enemy.fighter.x = 30 * U;
    expect(tracker.update(state)).toHaveLength(0);
    enemy.fighter.x = -U; tick(state);
    expect(tracker.update(state)).toHaveLength(0);
  });

  it('stacks arrows per edge, flags warned back attackers and skips KO enemies', () => {
    const state = createSurvival(5), tracker = new EdgeTracker();
    const a = spawnEnemy(state, 1), b = spawnEnemy(state, 1), c = spawnEnemy(state, -1), dead = spawnEnemy(state, -1);
    dead.dead = true; b.warn = 12;
    tracker.update(state); tick(state, EDGE_DELAY);
    const marks = tracker.update(state).map(m => ({ ...m }));
    expect(marks).toEqual([
      { uid: a.uid, side: 1, slot: 0, warn: false, boss: false },
      { uid: b.uid, side: 1, slot: 1, warn: true, boss: false },
      { uid: c.uid, side: -1, slot: 0, warn: false, boss: false },
    ]);
    expect(a.fighter.x).toBeGreaterThan(W);
  });

  it('starts over with a new run and never writes the state', () => {
    const state = createSurvival(8), tracker = new EdgeTracker();
    spawnEnemy(state, -1);
    tracker.update(state); tick(state, EDGE_DELAY);
    const before = snapshotSurvival(state);
    expect(tracker.update(state)).toHaveLength(1);
    expect(state).toEqual(before);
    // Frame counter went back (Backspace): earlier sightings do not count.
    const fresh = createSurvival(8);
    spawnEnemy(fresh, -1); tick(fresh, 2);
    expect(tracker.update(fresh)).toHaveLength(0);
  });
});
