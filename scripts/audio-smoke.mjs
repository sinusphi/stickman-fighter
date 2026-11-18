import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { TEST_URL, chromeExecutable } from './smoke-env.mjs';

const browser = await chromium.launch({
  executablePath: chromeExecutable(),
  headless: true, args: ['--no-sandbox', '--mute-audio'],
});
const output = 'test-results/audio';
await mkdir(output, { recursive:true });
try {
  const page = await browser.newPage({ viewport:{ width:1280, height:1080 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Exercise the actual game hooks with no browser audio API or sound device.
  await page.addInitScript(() => { window.AudioContext = undefined; });
  await page.goto(TEST_URL);
  await page.locator('#game[data-ready="true"]').waitFor();
  await expect(page.locator('#sound')).toHaveText('Sound: On');
  await expect(page.locator('#sound')).toHaveAttribute('title','Mute fight sounds');
  await page.locator('#sound').click();
  await expect(page.locator('#sound')).toHaveAttribute('aria-pressed','false');
  expect(await page.evaluate(() => localStorage.getItem('stickman.audio.muted'))).toBe('true');
  await page.reload(); await page.locator('#game[data-ready="true"]').waitFor();
  await expect(page.locator('#sound')).toHaveText('Sound: Off');
  await page.locator('#language').click();
  await expect(page.locator('#sound')).toHaveText('Ton: Aus');
  await expect(page.locator('#sound')).toHaveAttribute('title','Kampf-Sounds einschalten');
  await page.locator('#sound').click(); await page.locator('#language').click();
  await page.locator('#pause').click(); await page.locator('#states').click();
  await page.evaluate(async () => {
    // Vite may append an HMR timestamp. Instrument the exact module used by main.
    const url = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/platform/audio.ts')?.name;
    if (!url) throw Error('The game did not load the audio module.');
    const { HitAudio } = await import(url);
    window.TestHitAudio = HitAudio;
    const contact = HitAudio.prototype.playContact, swing = HitAudio.prototype.playSwing;
    window.hitSounds = []; window.swingSounds = [];
    HitAudio.prototype.playContact = function (sound) {
      window.hitSounds.push({ kind:sound.kind, strength:sound.strength, blocked:sound.blocked });
      contact.call(this, sound);
    };
    HitAudio.prototype.playSwing = function (sound) {
      window.swingSounds.push({ kind:sound.kind, strength:sound.strength });
      swing.call(this, sound);
    };
  });
  const count = () => page.evaluate(() => window.hitSounds.length);
  const swings = () => page.evaluate(() => window.swingSounds.length);
  const steps = n => page.locator('#step').evaluate((button, n) => { for (let i = 0; i < n; i++) button.click(); }, n);
  const approach = async () => { await page.keyboard.down('d'); await steps(110); await page.keyboard.up('d'); };
  await approach(); await page.locator('#record').click();
  await page.keyboard.down('d'); await page.keyboard.down('g'); await page.keyboard.down('b');
  await steps(1);
  await page.keyboard.up('g'); await page.keyboard.up('b'); await page.keyboard.up('d');
  await steps(169); await page.locator('#record').click();
  await expect(page.locator('#hp-1')).toHaveText('805 / 1000');
  expect(await count()).toBe(3);
  expect(await page.evaluate(() => window.hitSounds)).toEqual([
    { kind:'kick', strength:'middle', blocked:false }, { kind:'kick', strength:'high', blocked:false }, { kind:'kick', strength:'light', blocked:false }]);
  expect(await swings()).toBe(3);
  await page.locator('#play').click();
  await expect(page.locator('#notice')).toContainText('Replay ended', { timeout:10000 });
  expect(await count()).toBe(6); expect(await swings()).toBe(6);
  await page.locator('#play').click(); await steps(20);
  expect(await count()).toBe(6);
  // Reset/training via queue() while paused stay silent; an actual blocked hit plays one block sound.
  await page.locator('#reset').click(); await page.locator('#training').click();
  await page.locator('#dummy').click(); await page.locator('#dummy').click();
  await expect(page.locator('#dummy')).toContainText('Always block');
  await approach(); await page.keyboard.down('r'); await steps(1); await page.keyboard.up('r'); await steps(40);
  await expect(page.locator('#hp-1')).toHaveText('1000 / 1000');
  expect(await count()).toBe(7);
  expect(await page.evaluate(() => window.hitSounds.at(-1))).toEqual({ kind:'punch', strength:'light', blocked:true });
  await page.locator('#training').click(); await approach();
  await page.locator('#pause').click(); await page.keyboard.press('r');
  await expect(page.locator('#hp-1')).toHaveText('970 / 1000');
  await page.locator('#pause').click();
  expect(await count()).toBe(8);
  await page.screenshot({ path:`${output}/toolbar.png`, fullPage:true });
  await page.setViewportSize({ width:600, height:900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path:`${output}/narrow.png`, fullPage:true });

  // Real Web Audio nodes rendered offline: no speakers, autoplay policy or hardware required.
  const waveforms = await page.evaluate(async () => {
    const HitAudio = window.TestHitAudio;
    const url = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/platform/hit-sound.ts')?.name;
    const { describeStrike } = await import(url);
    const results = [];
    const cases = ['standing_lp','standing_mp','standing_hp','jumping_uppercut','standing_lk','standing_mk','standing_hk','spin_hk','dwit_chagi']
      .flatMap(id => ['hit','block','swing'].map(type => ({ id,type,voices:1 })));
    cases.push({ id:'spin_hk',type:'hit',voices:8 }, { id:'spin_hk',type:'finisher',voices:1 }, { id:'spin_hk',type:'swing',voices:12 });
    for (const { id,type,voices } of cases) {
      const context = new OfflineAudioContext(1,48000,48000);
      Object.defineProperty(context,'state',{ value:'running' });
      window.AudioContext = function () { return context; };
      const audio = new HitAudio();
      const sound = describeStrike(id);
      for (let voice = 0; voice < voices; voice++) {
        if (type === 'swing') audio.playSwing({ ...sound, leadSeconds:0.12 });
        else if (type === 'block') audio.playBlock(sound);
        else audio.playHit({ ...sound, finisher:type === 'finisher' });
      }
      const rendered = await context.startRendering(), samples = rendered.getChannelData(0);
      const peak = samples.reduce((maximum, value) => Math.max(maximum,Math.abs(value)),0);
      const rms = Math.sqrt(samples.reduce((sum,value) => sum+value*value,0)/samples.length);
      const tail = samples.slice(24000).reduce((maximum,value) => Math.max(maximum,Math.abs(value)),0);
      results.push({ id,type,voices,peak,rms,tail,finite:samples.every(Number.isFinite) });
    }
    return results;
  });
  for (const result of waveforms) {
    expect(result.finite).toBe(true); expect(result.peak).toBeGreaterThan(0.01);
    expect(result.peak).toBeLessThan(1); expect(result.rms).toBeGreaterThan(0.001); expect(result.tail).toBeLessThan(0.00001);
  }
  // Real WAV decoding + complete offline rendering, including the missing-folder fallback.
  const hybrids = await page.evaluate(async () => {
    const HitAudio = window.TestHitAudio;
    const url = performance.getEntriesByType('resource').find(entry => new URL(entry.name).pathname === '/src/platform/hit-sound.ts')?.name;
    const { describeStrike } = await import(url);
    const originalFetch = window.fetch, originalRandom = Math.random, originalContext = window.AudioContext;
    const results = [], baseline = new Map();
    try {
      for (const mode of ['disabled','empty','missing','hybrid','muted']) for (const type of ['hit','block','swing']) {
        let seed = 12345;
        Math.random = () => { seed = (Math.imul(seed,1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        const context = new OfflineAudioContext(2,96000,48000), loads = [], decodes = [], sources = [];
        Object.defineProperty(context,'state',{ value:'running' });
        const decode = context.decodeAudioData.bind(context), create = context.createBufferSource.bind(context);
        context.decodeAudioData = data => { const task = decode(data); decodes.push(task); return task; };
        context.createBufferSource = () => { const source = create(); sources.push(source); return source; };
        window.AudioContext = function () { return context; };
        window.fetch = (...args) => {
          // HTTP 404 for every file models a deployment with no public/sounds folder.
          const task = mode === 'missing' ? Promise.resolve(new Response('',{ status:404 })) : originalFetch(...args);
          loads.push(task); return task;
        };
        const audio = new HitAudio(mode === 'empty' ? { manifest:{} } : { search:mode === 'disabled' ? '?samples=0' : '?samples=1' });
        audio.setMuted(false); audio.unlock();
        await Promise.all(loads);
        if (mode === 'hybrid' || mode === 'muted') {
          const deadline = performance.now()+5000;
          while (decodes.length < 9 && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve,10));
          if (decodes.length !== 9) throw Error(`Expected 9 sample decodes (${mode}/${type}), got ${decodes.length}`);
          await Promise.all(decodes);
        }
        // Rendering the paused game can also consume Math.random while fetch/decode awaits.
        seed = 67890;
        const sound = { ...describeStrike('standing_hp'), pan:0.4 };
        if (type === 'swing') audio.playSwing({ ...sound,leadSeconds:0.12 });
        else if (type === 'block') audio.playBlock(sound);
        else audio.playHit(sound);
        if (mode === 'muted') audio.setMuted(true);
        const rendered = await context.startRendering(), samples = rendered.getChannelData(0);
        const peak = samples.reduce((maximum,value) => Math.max(maximum,Math.abs(value)),0);
        const rms = Math.sqrt(samples.reduce((sum,value) => sum+value*value,0)/samples.length);
        const tail = samples.slice(72000).reduce((maximum,value) => Math.max(maximum,Math.abs(value)),0);
        if (mode === 'disabled') baseline.set(type,samples.slice());
        // Native DSP rounding and asynchronous onended cleanup can vary the near-silent tail.
        // Bound the waveform delta below the synth envelope floor (-80 dBFS), and also compare energy/peak.
        const maxSynthDelta = samples.reduce((maximum,value,i) => Math.max(maximum,Math.abs(value-baseline.get(type)[i])),0);
        const reference = baseline.get(type);
        const referencePeak = reference.reduce((maximum,value) => Math.max(maximum,Math.abs(value)),0);
        const referenceRms = Math.sqrt(reference.reduce((sum,value) => sum+value*value,0)/reference.length);
        const sameAsSynth = maxSynthDelta < 0.0001 && Math.abs(peak-referencePeak) < 1e-6 && Math.abs(rms-referenceRms) < 1e-6;
        results.push({ mode,type,peak,rms,tail,sameAsSynth,maxSynthDelta,loads:loads.length,decodes:decodes.length,
          sampleSources:sources.filter(source => !source.loop).length,finite:samples.every(Number.isFinite) });
      }
    } finally { window.fetch = originalFetch; Math.random = originalRandom; window.AudioContext = originalContext; }
    return results;
  });
  await writeFile(`${output}/sample-waveforms.json`, JSON.stringify(hybrids,null,2)+'\n');
  for (const result of hybrids) {
    expect(result.finite).toBe(true); expect(result.peak).toBeLessThan(1); expect(result.tail).toBeLessThan(0.00001);
    expect(result.sampleSources).toBe(['hybrid','muted'].includes(result.mode) ? 1 : 0);
    expect(result.loads).toBe(['disabled','empty'].includes(result.mode) ? 0 : 9);
    if (result.mode === 'muted') expect(result.peak).toBe(0);
    else { expect(result.peak).toBeGreaterThan(0.01); expect(result.rms).toBeGreaterThan(0.0005); } // Two-second render, including silence.
    if (['missing','empty'].includes(result.mode)) expect(result.sameAsSynth, `${result.mode}/${result.type}`).toBe(true);
    if (result.mode === 'hybrid') expect(result.sameAsSynth).toBe(false);
  }
  await writeFile(`${output}/waveforms.json`, JSON.stringify(waveforms,null,2)+'\n');
  if (errors.length) throw Error(errors.join('\n'));
  console.log('Audio smoke passed: no-AudioContext live/playback/step hooks, multi-hit deduplication, swings, block sound, reset silence, EN/DE persisted mute, narrow layout, offline Web Audio synth/hybrid waveforms, nine real WAV decodes, A/B switch, sample mute and synth fallback for missing files/empty manifest.');
} finally { await browser.close(); }
