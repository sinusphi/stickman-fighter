import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative, sep } from 'node:path';

/** PCM WAV, including extra RIFF chunks and odd-byte padding. No conversion or dependencies. */
export function measureWav(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw Error('Not a RIFF WAVE file');
  let format, data;
  for (let at = 12; at + 8 <= bytes.length;) {
    const tag = bytes.toString('ascii', at, at + 4), size = bytes.readUInt32LE(at + 4), start = at + 8;
    if (start + size > bytes.length) throw Error('Truncated WAV chunk');
    if (tag === 'fmt ') format = bytes.subarray(start, start + size);
    if (tag === 'data') data = bytes.subarray(start, start + size);
    at = start + size + (size % 2);
  }
  if (!format || format.length < 16 || !data || !data.length) throw Error('Missing WAV format/data');
  const channels = format.readUInt16LE(2), sampleRate = format.readUInt32LE(4), bits = format.readUInt16LE(14);
  if (format.readUInt16LE(0) !== 1 || ![8, 16, 24, 32].includes(bits) || !channels || !sampleRate) throw Error('Expected integer PCM WAV');
  const width = bits / 8, frameBytes = channels * width;
  if (format.readUInt16LE(12) !== frameBytes || data.length % frameBytes) throw Error('Invalid PCM alignment');
  const count = data.length / width;
  const amplitude = i => bits === 8 ? (data[i] - 128) / 128 : data.readIntLE(i * width, width) / (2 ** (bits - 1));
  let peak = 0, peakIndex = 0, squares = 0;
  for (let i = 0; i < count; i++) {
    const value = amplitude(i);
    squares += value * value;
    if (Math.abs(value) > peak) { peak = Math.abs(value); peakIndex = i; }
  }
  let onset = 0;
  if (peak) while (onset < count && Math.abs(amplitude(onset)) <= peak * 0.1) onset++;
  const rms = Math.sqrt(squares / count), ms = i => Math.floor(i / channels) / sampleRate * 1000;
  return {
    durationMs: data.length / frameBytes / sampleRate * 1000, sampleRate, bytes: bytes.length,
    peak, rmsDb: rms ? 20 * Math.log10(rms) : null,
    onsetMs: Math.max(0, ms(onset) - 1), peakMs: ms(peakIndex),
    trim: Math.min(peak ? 0.98 / peak : 1.6, Math.max(0.5, Math.min(1.6, rms ? 10 ** (-12 / 20) / rms : 1.6))),
  };
}

export async function soundMetadata(root) {
  const files = [];
  async function walk(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await walk(root);
  const result = {};
  for (const path of files.sort()) result[relative(root, path).split(sep).join('/')] = measureWav(await readFile(path));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const metadata = await soundMetadata(fileURLToPath(new URL('../public/sounds/', import.meta.url)));
  const output = new URL('../src/data/sound-meta.json', import.meta.url), content = `${JSON.stringify(metadata, null, 2)}\n`;
  if (process.argv.includes('--check')) {
    if (await readFile(output, 'utf8') !== content) throw Error('Sound metadata stale: npm run generate:sound-meta');
  } else await writeFile(output, content);
  console.log(`Sound metadata synchronized (${Object.keys(metadata).length} files).`);
}
