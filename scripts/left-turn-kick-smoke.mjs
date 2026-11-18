/** Left Turn Kick im Browser: Zurück halten + LK löst den Tritt aus, trifft mit
 * 70 Schaden, und der Treffer sowie die Vorschau werden als Bild abgelegt. */
import { chromium } from '@playwright/test';
import { expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { TEST_URL, chromeExecutable } from './smoke-env.mjs';
const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true, args: ['--no-sandbox'] });
const output = 'test-results/left-turn-kick'; await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(TEST_URL);
  await page.locator('#game[data-ready="true"]').waitFor();
  await page.locator('#pause').click(); await page.locator('#states').click();
  for (const [key, back, forward, player] of [['f', 'a', 'd', 0], ['Numpad4', 'ArrowRight', 'ArrowLeft', 1]]) {
    const startup = await page.evaluate(async () => (await import('/src/data/schema.ts')).MOVES.left_turn_kick.startup);
    await page.locator('#reset').click();
    // Beide zusammenlaufen lassen, damit der Tritt in Reichweite ist.
    await page.keyboard.down(forward); await page.locator('#step').evaluate(b => { for (let i = 0; i < 110; i++) b.click(); }); await page.keyboard.up(forward);
    await page.keyboard.down(back); await page.keyboard.down(key); await page.locator('#step').click();
    await expect(page.locator(`#state-${player}`)).toContainText('left_turn_kick');
    await page.keyboard.up(key);
    await page.locator('#step').evaluate((b, n) => { for (let i = 0; i < n; i++) b.click(); }, startup);
    await expect(page.locator(`#hp-${1 - player}`)).toHaveText('930 / 1000');
    await page.locator('#boxes').click();
    await page.locator('#game').screenshot({ path: `${output}/p${player + 1}-contact.png` });
    await page.locator('#boxes').click(); await page.keyboard.up(back);
    // Ohne gehaltenes Zurück bleibt es der normale LK.
    await page.locator('#reset').click(); await page.keyboard.down(key); await page.locator('#step').click(); await page.keyboard.up(key);
    await expect(page.locator(`#state-${player}`)).toContainText('standing_lk');
  }
  await page.locator('#animation-preview summary').click();
  await page.locator('#preview-animation').selectOption('left_turn_kick');
  for (const facing of [1, -1]) {
  if(facing === -1) await page.locator('#preview-mirror').click();
  for (const frame of [0, 10, 18, 26, 35, 46, 57, 65]) {
    await page.locator('#preview-time').fill(String(frame));
    await expect(page.locator('#preview-canvas')).toHaveAttribute('data-frame', frame.toFixed(2));
    await page.locator('#animation-preview').screenshot({ path: `${output}/preview-${facing}-${String(frame).padStart(2, '0')}.png` });
  }
  }
  if (errors.length) throw Error(`Seitenfehler: ${errors.join(' | ')}`);
  console.log(`Left Turn Kick Smoke ok — Bilder in ${output}`);
} finally { await browser.close(); }
