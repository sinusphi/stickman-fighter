import rules from '../data/rules.json';
import type { SurvivalState } from '../survival/state';

/*
 * Edge arrows of the survival renderer. Enemies spawn `spawnOffset` px outside
 * the arena and walk in; that takes about 14 frames with the body centre
 * outside. An enemy whose body centre stays outside the canvas longer than
 * EDGE_DELAY simulation frames (hitstop during the walk-in, the frozen crowd
 * after game over) gets a small arrow at the canvas edge. Presentation only:
 * reads the survival state, never writes it.
 */

/** Simulation frames an enemy's body centre must stay outside before its arrow shows (a normal walk-in is shorter). */
export const EDGE_DELAY = 16;
const WIDTH = rules.stageWidth / rules.unit;

export interface EdgeMark {
  uid: number;
  /** -1 left edge, 1 right edge. */
  side: -1 | 1;
  /** Stack slot on its edge (0 = first), ordered by spawn. */
  slot: number;
  /** Back attacker during its warning. */
  warn: boolean;
  boss: boolean;
}

export class EdgeTracker {
  /** First frame each enemy was seen outside. */
  private since = new Map<number, number>();
  private frame = -1;
  private pool: EdgeMark[] = [];
  /** Current marks; reused between calls (no allocation per frame in the steady state). */
  readonly marks: EdgeMark[] = [];

  update(state: SurvivalState): readonly EdgeMark[] {
    // A new run (or a reset) starts the frame counter over.
    if (state.frame < this.frame) this.since.clear();
    this.frame = state.frame;
    this.marks.length = 0;
    let left = 0, right = 0;
    for (const e of state.enemies) {
      const x = e.fighter.x / rules.unit;
      const side = e.dead ? 0 : x < 0 ? -1 : x > WIDTH ? 1 : 0;
      if (!side) { this.since.delete(e.uid); continue; }
      const first = this.since.get(e.uid);
      if (first === undefined) { this.since.set(e.uid, state.frame); continue; }
      if (state.frame - first < EDGE_DELAY) continue;
      if (this.pool.length === this.marks.length) this.pool.push({ uid: 0, side: -1, slot: 0, warn: false, boss: false });
      const mark = this.pool[this.marks.length];
      mark.uid = e.uid; mark.side = side; mark.slot = side < 0 ? left++ : right++;
      mark.warn = e.warn > 0; mark.boss = e.boss > 0;
      this.marks.push(mark);
    }
    if (this.since.size > state.enemies.length) {
      for (const uid of this.since.keys()) if (!state.enemies.some(e => e.uid === uid)) this.since.delete(uid);
    }
    return this.marks;
  }

  reset(): void { this.since.clear(); this.frame = -1; this.marks.length = 0; }
}
