// Browser smoke for the presentation-only hit effects: settings toggles and
// persistence, reduced-motion default, and a real two-hit combo whose sparks
// and combo counter are drawn in both themes on all three arenas.
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { TEST_URL, chromeExecutable } from './smoke-env.mjs';
const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true, args: ['--no-sandbox'] });
const output = 'test-results/effects'; await mkdir(output, { recursive: true });
try {
  // Reduced motion: camera motion is off by default, effects stay on.
  {
    const context = await browser.newContext({ reducedMotion: 'reduce' }), page = await context.newPage();
    await page.goto(TEST_URL); await page.locator('#game[data-ready="true"]').waitFor();
    await page.locator('#settings-details summary').click();
    await expect(page.locator('#effects-toggle')).toBeChecked();
    await expect(page.locator('#shake-toggle')).not.toBeChecked();
    await context.close();
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(TEST_URL); await page.locator('#game[data-ready="true"]').waitFor();
  // Toggles persist like stickman.language.
  await page.locator('#settings-details summary').click();
  await expect(page.locator('#effects-toggle')).toBeChecked();
  await expect(page.locator('#shake-toggle')).toBeChecked();
  await page.locator('#shake-toggle').uncheck();
  await page.locator('#effects-toggle').uncheck();
  expect(await page.evaluate(() => [localStorage.getItem('stickman.effects'), localStorage.getItem('stickman.shake')])).toEqual(['off', 'off']);
  await page.reload(); await page.locator('#game[data-ready="true"]').waitFor();
  await page.locator('#settings-details summary').click();
  await expect(page.locator('#effects-toggle')).not.toBeChecked();
  await page.locator('#effects-toggle').check(); await page.locator('#shake-toggle').check();
  expect(await page.evaluate(() => localStorage.getItem('stickman.effects'))).toBe('on');
  await page.locator('#settings-details summary').click();

  const steps = n => page.locator('#step').evaluate((b, n) => { for (let i = 0; i < n; i++) b.click(); }, n);
  const canvasHash = () => page.locator('#game').evaluate(canvas => { let h = 0; const d = canvas.toDataURL(); for (let i = 0; i < d.length; i += 7) h = (h * 31 + d.charCodeAt(i)) | 0; return h; });
  const ensurePaused = async () => { if ((await page.locator('#pause').textContent()).match(/Pause/)) await page.locator('#pause').click(); };
  for (const theme of ['dark', 'light']) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#theme').click();
    for (const stage of ['dojo', 'rooftop', 'shrine']) {
      await page.locator(`[data-stage="${stage}"]`).click();
      await ensurePaused();
      await page.locator('#reset').click();
      await page.keyboard.down('d'); await steps(105); await page.keyboard.up('d');
      // Forward + T + N: medium jab → right high kick.
      await page.keyboard.down('d'); await page.keyboard.down('t'); await page.keyboard.down('n');
      await page.locator('#step').click();
      await page.keyboard.up('t'); await page.keyboard.up('n'); await page.keyboard.up('d');
      for (let i = 0; i < 80 && await page.locator('#hp-1').textContent() !== '850 / 1000'; i++) await page.locator('#step').click();
      await expect(page.locator('#hp-1')).toHaveText('850 / 1000');
      await page.waitForTimeout(80);
      await page.locator('#game').screenshot({ path: `${output}/${theme}-${stage}-combo.png` });
      // The frozen frame differs only by the effects: switching them off must change the canvas.
      const withEffects = await canvasHash();
      await page.locator('#settings-details summary').click(); await page.locator('#effects-toggle').uncheck();
      await page.waitForTimeout(80);
      const without = await canvasHash();
      await page.locator('#effects-toggle').check(); await page.locator('#settings-details summary').click();
      if (withEffects === without) throw Error(`${theme}/${stage}: effects not visible on the contact frame`);
    }
  }
  if (errors.length) throw Error(`Seitenfehler: ${errors.join(' | ')}`);
  console.log(`Effects Smoke ok — Bilder in ${output}`);
} finally { await browser.close(); }
