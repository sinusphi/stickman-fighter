import { animations } from '../render/skeleton';
import type { GameState } from '../simulation/types';

/** Wall-clock speed while a knockout plays out (1 = normal). Presentation only. */
export const KO_SLOW_MOTION_SCALE = 0.4;

/**
 * True once every fighter has reached its final pose after a KO / double KO:
 * KO fighters have finished the fall animation, surviving fighters stand
 * grounded in Idle and no hitstop is pending.
 */
export function koSettled(game: GameState, koFrames: number[]): boolean {
  if (game.hitstop > 0) return false;
  const lastKoFrame = animations.KO.durationFrames - 1;
  return game.fighters.every(f => f.state === 'KO'
    ? (koFrames[f.id] ?? 0) >= lastKoFrame
    : f.state === 'Idle' && f.y === 0);
}

/**
 * Tracks the knockout slow motion: it starts on the frame the round is decided
 * by KO or DOUBLE KO and ends for good once everything has settled.
 * It only scales the pace of the fixed-step loop; simulation frames are unchanged.
 */
export class KoSlowMotion {
  private finished = false;
  active = false;

  update(game: GameState, koFrames: number[]): number {
    const knockout = game.round.phase !== 'fighting' && (game.round.reason === 'KO' || game.round.reason === 'DOUBLE KO');
    if (!knockout) { this.finished = false; this.active = false; return 1; }
    if (!this.finished && koSettled(game, koFrames)) this.finished = true;
    this.active = !this.finished;
    return this.active ? KO_SLOW_MOTION_SCALE : 1;
  }

  reset(): void { this.finished = false; this.active = false; }
}
