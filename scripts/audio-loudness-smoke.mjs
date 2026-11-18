import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { TEST_URL, chromeExecutable } from './smoke-env.mjs';

const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true, args: ['--no-sandbox', '--mute-audio'] });
try {
  const page = await browser.newPage();
  await page.goto(TEST_URL);
  await page.locator('#game[data-ready="true"]').waitFor();
  await page.locator('#pause').click();
  const results = await page.evaluate(async () => {
    const { HitAudio } = await import('/src/platform/audio.ts');
    const { describeStrike } = await import('/src/platform/hit-sound.ts');
    const { MOVES } = await import('/src/data/schema.ts');
    const cases = Object.values(MOVES).flatMap(move => move.hitGroups.map(group => ({ id: move.id, group: group.id })));
    const originalRandom = Math.random, originalContext = window.AudioContext;
    const results = [];
    try {
      for (const mode of ['hybrid', 'synth']) for (const { id, group } of cases)
        for (const type of ['hit', 'block', 'swing', 'finisher']) for (const variation of [67890, 42]) {
          const sound = describeStrike(id, group);
          let seed = 12345;
          Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
          const context = new OfflineAudioContext(1, 48000, 48000);
          Object.defineProperty(context, 'state', { value: 'running' });
          const decodes = [], decode = context.decodeAudioData.bind(context);
          context.decodeAudioData = data => { const task = decode(data); decodes.push(task); return task; };
          window.AudioContext = function () { return context; };
          const audio = new HitAudio({ search: mode === 'hybrid' ? '?samples=1' : '?samples=0' });
          audio.setMuted(false); audio.unlock();
          if (mode === 'hybrid') {
            const deadline = performance.now() + 5000;
            while (decodes.length < 9 && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
            if (decodes.length !== 9) throw Error(`Expected all nine WAVs: ${id}/${group}/${type}`);
            await Promise.all(decodes); await Promise.resolve();
          }
          seed = variation;
          if (type === 'swing') audio.playSwing({ ...sound, leadSeconds: 0.12 });
          else if (type === 'block') audio.playBlock(sound);
          else audio.playHit({ ...sound, finisher: type === 'finisher' });
          const rendered = await context.startRendering(), samples = rendered.getChannelData(0);
          // A fixed 100-ms window measures the audible event, without dilution by trailing silence.
          const windowFrames = 4800;
          let peak = 0, energy = 0, maximum = 0;
          for (let i = 0; i < samples.length; i++) {
            peak = Math.max(peak, Math.abs(samples[i]));
            energy += samples[i] * samples[i];
            if (i >= windowFrames) energy -= samples[i - windowFrames] * samples[i - windowFrames];
            if (i >= windowFrames - 1) maximum = Math.max(maximum, energy / windowFrames);
          }
          results.push({ mode, id, group, type, variation, db: 10 * Math.log10(maximum), peak, finite: samples.every(Number.isFinite) });
        }
    } finally { Math.random = originalRandom; window.AudioContext = originalContext; }
    return results;
  });
  await mkdir('test-results/audio', { recursive: true });
  await writeFile('test-results/audio/loudness.json', JSON.stringify(results, null, 2) + '\n');
  for (const result of results) {
    const label = `${result.mode}/${result.id}/${result.group}/${result.type}/${result.variation}`;
    expect(result.finite, label).toBe(true);
    expect(result.peak, label).toBeLessThan(0.8);
    expect(result.db, label).toBeGreaterThan(-27);
    expect(result.db, label).toBeLessThan(-18);
  }
  for (const mode of ['hybrid', 'synth']) for (const type of ['hit', 'block', 'swing', 'finisher']) {
    const levels = results.filter(result => result.mode === mode && result.type === type).map(result => result.db);
    const minimum = Math.min(...levels), maximum = Math.max(...levels);
    expect(maximum - minimum, `${mode}/${type} loudness spread`).toBeLessThan(type === 'hit' || type === 'finisher' ? 5 : 4);
    console.log(`${mode}/${type}: ${minimum.toFixed(1)} … ${maximum.toFixed(1)} dBFS`);
  }
  console.log(`Audio loudness smoke passed (${results.length} real Web Audio renders, every move/hit group, WAV+synth and synth fallback, two sample/random variants).`);
} finally { await browser.close(); }
