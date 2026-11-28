// Browser smoke for the game speed switch in the arena bar: button + three-position
// slider, persistence, the HUD badge under the round label and the measured
// simulation rate (frames per wall-clock second) per level, plus the parts that
// keep the standard pace: round intro and round timer (real seconds).
import { chromium, expect } from '@playwright/test';
import { SERVER_URL, TEST_URL, chromeExecutable } from './smoke-env.mjs';
const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(TEST_URL); await page.locator('#game[data-ready="true"]').waitFor();
  const toggle = page.locator('#speed-toggle'), slider = page.locator('#speed-level'), badge = page.locator('#speed-badge');
  // The old "best of three" label is gone; the switch sits in the arena bar.
  expect(await page.locator('.section-actions').innerText()).not.toMatch(/best of three/i);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(slider).toBeDisabled();
  await expect(badge).toBeHidden();
  // Simulation frames per wall-clock second, measured inside the page.
  const measure = (ms = 1500) => page.evaluate(ms => new Promise(resolve => {
    const canvas = document.querySelector('#game'), start = Number(canvas.dataset.frame), t0 = performance.now();
    setTimeout(() => resolve((Number(canvas.dataset.frame) - start) / ((performance.now() - t0) / 1000)), ms);
  }), ms);
  const phase = () => page.locator('#game').getAttribute('data-round');
  const fighting = () => page.waitForFunction(() => document.querySelector('#game').dataset.round?.startsWith('fighting|'), null, { timeout: 15000 });
  // The intro always runs at the standard pace: measure only once the round is on.
  await fighting();
  const rate = async () => { await page.waitForTimeout(200); return measure(); };
  const setLevel = level => slider.evaluate((el, value) => { el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, level);
  const base = await rate();
  if (base < 40) throw Error(`simulation not running (${base.toFixed(1)} fps)`);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(slider).toBeEnabled();
  for (const [level, scale] of [[1, 1.2], [2, 1.32], [3, 1.4]]) {
    await setLevel(level);
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(String(level));
    const text = await badge.innerText();
    if (!text.includes(String(level)) || text.includes('%')) throw Error(`badge for level ${level}: "${text}"`);
    const ratio = (await rate()) / base;
    console.log(`level ${level}: ${ratio.toFixed(3)}x (badge "${text}")`);
    if (Math.abs(ratio - scale) > 0.07) throw Error(`level ${level}: expected ~${scale}x, measured ${ratio.toFixed(3)}x`);
  }
  // The round timer keeps counting real seconds on level 3.
  const timerValue = async () => Number(await page.locator('#timer').innerText());
  const timerStart = await timerValue(); await page.waitForTimeout(5000);
  const timerDrop = timerStart - await timerValue();
  console.log(`level 3: timer dropped ${timerDrop} in 5 s`);
  if (timerDrop < 4 || timerDrop > 6) throw Error(`level 3: timer dropped ${timerDrop} in 5 s of real time`);
  await page.screenshot({ path: 'test-results/game-speed.png' });
  // No percentage anywhere in the visible UI.
  if (/\d+\s?%/.test(await page.locator('.section-bar').innerText())) throw Error('percentage shown in the arena bar');
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('stickman.speed')))).toEqual({ enabled: true, level: 3 });
  await page.reload(); await page.locator('#game[data-ready="true"]').waitFor();
  await expect(page.locator('#speed-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#speed-level')).toHaveValue('3');
  await expect(page.locator('#speed-badge')).toBeVisible();
  // The round intro (fists together) keeps the standard pace on level 3 (the app with its intro).
  await page.goto(SERVER_URL); await page.locator('#game[data-ready="true"]').waitFor();
  await page.waitForFunction(() => document.querySelector('#game').dataset.round?.startsWith('intro|'));
  const introRatio = (await measure(1000)) / base, introPhase = await phase();
  console.log(`level 3 intro: ${introRatio.toFixed(3)}x (${introPhase})`);
  if (!introPhase?.startsWith('intro|')) throw Error(`intro too short to measure (${introPhase})`);
  if (Math.abs(introRatio - 1) > 0.07) throw Error(`level 3 intro: expected ~1x, measured ${introRatio.toFixed(3)}x`);
  await fighting();
  // Switching off returns to the standard pace and hides the badge; the level is kept.
  await page.locator('#speed-toggle').click();
  await expect(page.locator('#speed-level')).toBeDisabled();
  await expect(page.locator('#speed-badge')).toBeHidden();
  const off = (await rate()) / base;
  if (Math.abs(off - 1) > 0.07) throw Error(`switched off: expected ~1x, measured ${off.toFixed(3)}x`);
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('stickman.speed')))).toEqual({ enabled: false, level: 3 });
  if (errors.length) throw Error(errors.join('\n'));
  console.log('game speed smoke ok');
} finally { await browser.close(); }
