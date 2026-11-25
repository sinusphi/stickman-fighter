import type { RawInput } from '../input/types';
import type { GameState } from '../simulation/types';
import { SURVIVAL, SURVIVAL_BEST_KEY } from './config';
import { Director } from './director';
import { EnemyPilot } from './pilot';
import { createSurvival, stepSurvival, type Enemy, type SurvivalState } from './state';
import { chooseUpgrade } from './upgrades';
import type { UpgradeId } from './config';

/**
 * One survival run: deterministic simulation plus the AI side (director and
 * one pilot per enemy). Everything is derived from one seed.
 */
export class SurvivalSession {
  state!: SurvivalState;
  readonly director: Director;
  private pilots = new Map<number, EnemyPilot>();
  private seed = 1;
  constructor(seed = 1, private inputConfig?: GameState['inputConfig'], readonly config = SURVIVAL) {
    this.director = new Director(seed, config);
    this.reset(seed);
  }

  reset(seed = this.seed, inputConfig = this.inputConfig): void {
    this.seed = seed | 0; this.inputConfig = inputConfig;
    this.state = createSurvival(this.seed, inputConfig, this.config);
    this.director.reset(this.seed ^ 0x51f15e);
    this.pilots.clear();
  }

  /** Input config changes (SOCD, buffer, auto block) apply immediately. */
  setInputConfig(config: GameState['inputConfig']): void {
    this.inputConfig = config;
    this.state.inputConfig = structuredClone(config);
    for (const e of this.state.enemies) e.pair.inputConfig = { ...config, autoBlock: [config.autoBlock?.[0] ?? false, false] };
  }

  pilot(enemy: Enemy): EnemyPilot {
    const uid = enemy.uid;
    let pilot = this.pilots.get(uid);
    if (!pilot) { pilot = new EnemyPilot(uid, (this.seed + Math.imul(uid, 0x2545f491)) | 0, this.director, enemy, this.config); this.pilots.set(uid, pilot); }
    return pilot;
  }

  /** True while the run waits for an upgrade pick (nothing moves). */
  get choosing(): boolean { return this.state.upgrades.offer !== null; }

  /** Takes card `index` (0-based) of the open upgrade choice; null when there is none. */
  choose(index: number): UpgradeId | null { return chooseUpgrade(this.state, index); }

  step(player: RawInput): void {
    const state = this.state;
    // Paused for the upgrade choice: neither the director nor the pilots run.
    if (state.upgrades.offer) return;
    this.director.update(state);
    const inputs = state.enemies.map(e => this.pilot(e).next(state, e));
    stepSurvival(state, player, inputs);
    for (const e of state.enemies) e.warn = this.director.warning(e.uid, state.frame);
    if (this.pilots.size > state.enemies.length) {
      const present = new Set(state.enemies.map(e => e.uid));
      for (const uid of this.pilots.keys()) if (!present.has(uid)) this.pilots.delete(uid);
    }
  }
}

/** Best survived time in frames (0 when none or storage is unavailable). */
export function loadBest(storage: Pick<Storage, 'getItem'>): number {
  try {
    const value = Number(storage.getItem(SURVIVAL_BEST_KEY));
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  } catch { return 0; }
}
export function saveBest(storage: Pick<Storage, 'setItem'>, frames: number): void {
  try { storage.setItem(SURVIVAL_BEST_KEY, String(frames)); } catch { /* Private browsing / quota. */ }
}
