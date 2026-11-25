/** Mulberry32 on a seed held in the given object; the only randomness of the survival simulation. */
export function random(stream: { seed: number }): number {
  stream.seed = (stream.seed + 0x6d2b79f5) | 0;
  let t = stream.seed;
  t = Math.imul(t ^ t >>> 15, t | 1);
  t ^= t + Math.imul(t ^ t >>> 7, t | 61);
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
