import rules from '../data/rules.json';

export class FixedLoop {
  private accumulator = 0;
  private previousTime: number | null = null;
  paused = false;
  /** Wall-clock multiplier (slow motion < 1). Frame size stays fixed, so the simulation stays deterministic. */
  timeScale = 1;
  readonly frameMs = 1000 / rules.hz;

  reset(): void { this.accumulator = 0; this.previousTime = null; }

  advance(time: number, update: () => void): number {
    if (this.previousTime === null) { this.previousTime = time; return 0; }
    const elapsed = Math.max(0, time - this.previousTime);
    this.previousTime = time;
    if (elapsed > rules.suspendAfterMs) { this.paused = true; this.accumulator = 0; }
    if (this.paused) return 0;
    this.accumulator += elapsed * this.timeScale;
    let count = 0;
    while (this.accumulator + 1e-7 >= this.frameMs && count < rules.maxCatchupFrames) {
      update();
      this.accumulator -= this.frameMs;
      count++;
    }
    return Math.max(0, Math.min(1, this.accumulator / this.frameMs));
  }
}
