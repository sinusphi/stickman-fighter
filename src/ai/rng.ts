/** Mulberry32: all gameplay choices come from this private, reproducible stream. */
export class Rng {
  constructor(private seed: number) {}
  /** Current internal state, e.g. to derive an independent stream. */
  peekSeed(): number { return this.seed >>> 0; }
  next(): number {
    this.seed = (this.seed + 0x6d2b79f5) | 0;
    let t = this.seed;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}
