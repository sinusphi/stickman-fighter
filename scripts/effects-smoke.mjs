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
  // Bar full: a real imported state (training, P2 Revenge at 97) and one light punch fill
  // the bar. Burst on the canvas, READY label and highlight in both themes.
  const readyReplay = await page.evaluate(async () => {
    const { createGame } = await import('/src/simulation/state.ts');
    const { createReplay } = await import('/src/debug/replay.ts');
    const { buttonBit } = await import('/src/input/types.ts');
    const game = createGame(), [a, b] = game.fighters;
    game.training = { enabled: true, dummy: 'stand' };
    a.x = 450 * 256; b.x = a.x + 45 * 256; b.resources.revenge.current = 97;
    const replay = createReplay(game), n = { up: false, down: false, left: false, right: false, buttons: 0 };
    for (let i = 0; i < 90; i++) replay.frames.push({ inputs: [i === 60 ? { ...n, buttons: buttonBit('LP') } : n, n], events: [] });
    return replay;
  });
  for (const theme of ['dark', 'light']) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#theme').click();
    await page.locator('#replay-file').setInputFiles({ name: 'ready.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(readyReplay)) });
    await page.locator('#play').click(); await ensurePaused();
    await expect(page.locator('#resource-ready-1-revenge')).not.toHaveClass(/is-visible/);
    for (let i = 0; i < 90 && await page.locator('#resource-value-1-revenge').textContent() !== '100 / 100'; i++) await page.locator('#step').click();
    await expect(page.locator('#resource-value-1-revenge')).toHaveText('100 / 100');
    await expect(page.locator('#resource-ready-1-revenge')).toHaveClass(/is-visible/);
    await expect(page.locator('#resource-ready-1-revenge')).toHaveText('REVENGE READY');
    await expect(page.locator('#resource-1-revenge')).toHaveClass(/is-full/);
    await expect(page.locator('#resource-1-revenge')).toHaveClass(/resource-flash/);
    await expect(page.locator('#resource-ready-0-revenge')).not.toHaveClass(/is-visible/);
    await page.waitForTimeout(80);
    await page.locator('.arena').screenshot({ path: `${output}/${theme}-ready-burst.png` });
    const withBurst = await canvasHash();
    await page.locator('#settings-details summary').click(); await page.locator('#effects-toggle').uncheck();
    await page.waitForTimeout(80);
    const without = await canvasHash();
    await expect(page.locator('#resource-1-revenge')).not.toHaveClass(/is-pulsing/);
    await expect(page.locator('#resource-ready-1-revenge')).toHaveClass(/is-visible/);
    await page.locator('#effects-toggle').check(); await page.locator('#settings-details summary').click();
    if (withBurst === without) throw Error(`${theme}: bar-full burst not visible`);
    await page.locator('#play').click();
  }
  if (errors.length) throw Error(`Seitenfehler: ${errors.join(' | ')}`);
  console.log(`Effects Smoke ok — Bilder in ${output}`);
} finally { await browser.close(); }
