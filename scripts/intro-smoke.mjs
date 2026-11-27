// Versus round intro: READY UP -> walk-in -> fist salute -> FIGHT. Inputs stay
// locked and the timer stands until FIGHT; training skips the intro, a reset,
// the demo and a replay play it again; the German banner differs from the
// English one.
// Screenshots in test-results/intro.
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { SERVER_URL, chromeExecutable } from './smoke-env.mjs';

const output = 'test-results/intro'; await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(SERVER_URL);
  const canvas = page.locator('#game[data-ready="true"]');
  await canvas.waitFor();
  const round = () => page.locator('#game').getAttribute('data-round');
  // Polled every animation frame: the FIGHT step lasts only 40 simulation frames.
  const waitRound = value => page.waitForFunction(v => document.getElementById('game')?.dataset.round === v, value, { timeout: 5000, polling: 'raf' });
  const resume = async () => { if (await page.locator('#step').isEnabled()) await page.locator('#pause').click(); };
  const state = page.locator('#state-0');

  // 1. READY UP: both at the spawns, inputs locked (held forward + LP do nothing).
  expect(await round()).toMatch(/^intro\|(ready|approach)$/);
  await page.keyboard.down('d'); await page.keyboard.press('r');
  if (await round() === 'intro|ready') {
    await expect(state).toContainText('Idle');
    await page.locator('#game').screenshot({ path: `${output}/1-ready.png` });
  }
  await expect(page.locator('#timer')).toHaveText('99');

  // 2. Walk-in on its own, same speed both sides.
  await waitRound('intro|approach');
  await expect(state).toContainText('Walk');
  await expect(page.locator('#state-1')).toContainText('Walk');
  await page.locator('#game').screenshot({ path: `${output}/2-approach.png` });

  // 3. Fist salute: standing LP without damage or resources. Single-stepped
  // to the salute peak (move frame 9) where both fist tips touch.
  await page.keyboard.press('p');
  for (let i = 0; i < 80 && await round() !== 'intro|salute'; i++) await page.keyboard.press('.');
  expect(await round()).toBe('intro|salute');
  await expect(state).toContainText('standing_lp');
  for (let i = 0; i < 9; i++) await page.keyboard.press('.');
  await page.locator('#game').screenshot({ path: `${output}/3-salute-peak.png` });
  await page.keyboard.press('p');

  // 4. FIGHT: inputs free, timer starts now.
  await waitRound('fighting|fight');
  await page.locator('#game').screenshot({ path: `${output}/4-fight.png` });
  for (const id of ['hp-0', 'hp-1']) await expect(page.locator(`#${id}`)).toHaveText('1000 / 1000');
  for (const id of ['resource-value-0-special', 'resource-value-1-revenge']) await expect(page.locator(`#${id}`)).toHaveText('0 / 100');
  // The held forward walks at once; the timer runs.
  await expect(state).toContainText('Walk');
  await page.keyboard.up('d');
  await expect(page.locator('#timer')).toHaveText('98', { timeout: 2500 });
  await page.keyboard.press('r');
  await expect(state).toContainText('standing_lp');
  await waitRound('fighting|');

  // German banner: BEREITMACHEN! instead of READY UP! (banner area only; the figures stand outside it).
  const box = await page.locator('#game').boundingBox(), scale = box.width / 960;
  const bannerClip = { x: box.x + 400 * scale, y: box.y + 125 * scale, width: 160 * scale, height: 50 * scale };
  const bannerShot = async name => {
    await page.keyboard.press('Backspace');
    await waitRound('intro|ready'); await page.waitForTimeout(300);
    expect(await round()).toBe('intro|ready');
    return page.screenshot({ clip: bannerClip, path: `${output}/${name}.png` });
  };
  const english = await bannerShot('banner-en');
  await page.locator('#language').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  const german = await bannerShot('banner-de');
  expect(Buffer.compare(english, german)).not.toBe(0);
  await page.locator('#language').click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  // Training: no intro, straight into fighting; leaving it plays the intro again.
  await page.keyboard.press('F4');
  await expect(page.locator('#timer')).toHaveText('∞');
  await waitRound('fighting|');
  await page.keyboard.press('F4');
  await waitRound('intro|ready');

  // Replay: record a restart, the playback runs through the whole intro.
  await page.keyboard.press('F6');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  await waitRound('fighting|fight');
  await page.keyboard.press('F6');
  const seen = new Set();
  await page.keyboard.press('F7');
  const rounds = await page.evaluate(() => new Promise(done => {
    const seen = new Set(), until = performance.now() + 5000;
    const poll = () => { const value = document.getElementById('game').dataset.round; seen.add(value);
      if (value === 'fighting|fight' || performance.now() > until) done([...seen]); else requestAnimationFrame(poll); };
    poll();
  }));
  for (const value of rounds) seen.add(value);
  for (const value of ['intro|ready', 'intro|approach', 'intro|salute', 'fighting|fight']) expect(seen.has(value), `replay shows ${value}`).toBe(true);
  await page.keyboard.press('F7');
  await resume();

  // Demo (CPU vs CPU) also opens with the intro.
  await page.keyboard.press('F9');
  await waitRound('intro|ready');
  await waitRound('fighting|fight');
  await page.keyboard.press('F9');

  expect(errors).toEqual([]);
  console.log('intro smoke ok');
} finally { await browser.close(); }
