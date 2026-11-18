import type { Buffer } from 'node:buffer';

export interface WavMetadata {
  durationMs: number;
  sampleRate: number;
  bytes: number;
  peak: number;
  rmsDb: number | null;
  onsetMs: number;
  peakMs: number;
  trim: number;
}
export function measureWav(bytes: Buffer): WavMetadata;
export function soundMetadata(root: string): Promise<Record<string, WavMetadata>>;
