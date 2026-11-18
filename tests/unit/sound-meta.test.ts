import { expect, it } from 'vitest';
import { measureWav, soundMetadata } from '../../scripts/generate-sound-meta.mjs';

function wav(values: number[]) {
  const buffer = Buffer.alloc(54 + values.length * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVE', 8);
  buffer.write('JUNK', 12); buffer.writeUInt32LE(1, 16); // Odd chunk with one padding byte.
  buffer.write('fmt ', 22); buffer.writeUInt32LE(16, 26);
  buffer.writeUInt16LE(1, 30); buffer.writeUInt16LE(1, 32); buffer.writeUInt32LE(1000, 34);
  buffer.writeUInt32LE(2000, 38); buffer.writeUInt16LE(2, 42); buffer.writeUInt16LE(16, 44);
  buffer.write('data', 46); buffer.writeUInt32LE(values.length * 2, 50);
  values.forEach((value, i) => buffer.writeInt16LE(value, 54 + i * 2));
  return buffer;
}
it('measures PCM, skips padded chunks, finds onset and peak and balances loudness', () => {
  const result = measureWav(wav([0, 0, 0, 16384, 8192]));
  expect(result).toMatchObject({ durationMs: 5, sampleRate: 1000, bytes: 64, peak: 0.5, onsetMs: 2, peakMs: 3 });
  expect(result.rmsDb).toBeCloseTo(20 * Math.log10(0.25));
  expect(result.trim).toBeCloseTo(10 ** (-12 / 20) / 0.25);
  expect(measureWav(wav([1, 0])).trim).toBe(1.6);
  expect(measureWav(wav([32767, 32767])).trim).toBe(0.5);
  const impulsive = measureWav(wav([32767, ...Array(99).fill(0)]));
  expect(impulsive.peak * impulsive.trim).toBeCloseTo(0.98);
});
it('handles silence without non-finite metadata and rejects malformed files', () => {
  expect(measureWav(wav([0, 0]))).toMatchObject({ peak: 0, onsetMs: 0, peakMs: 0, rmsDb: null, trim: 1.6 });
  expect(() => measureWav(Buffer.from('broken'))).toThrow();
  expect(() => measureWav(wav([100]).subarray(0, 55))).toThrow('Truncated');
});
it('returns empty metadata if the entire optional sounds directory is missing', async () => {
  expect(await soundMetadata('/tmp/stickman-sound03-missing/no-sounds')).toEqual({});
});
