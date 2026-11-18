import { chromium } from '@playwright/test';
import { expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { TEST_URL, chromeExecutable } from './smoke-env.mjs';
const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true, args: ['--no-sandbox'] });
const output = 'test-results/middle-high-punch'; await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(TEST_URL);
  await page.locator('#game[data-ready="true"]').waitFor();
  await page.locator('#pause').click(); await page.locator('#states').click();
  for (const [key, second, back, forward, player] of [['h', 'n', 'd', 'd', 0], ['Numpad6', 'Numpad3', 'ArrowLeft', 'ArrowLeft', 1]]) {
    const startup = await page.evaluate(async () => (await import('/src/data/schema.ts')).MOVES.middle_high_punch_combo.startup);
    await page.locator('#reset').click();
    // Beide zusammenlaufen lassen, damit der Tritt in Reichweite ist.
    await page.keyboard.down(forward); await page.locator('#step').evaluate(b => { for (let i = 0; i < 110; i++) b.click(); }); await page.keyboard.up(forward);
    await page.keyboard.down(back); await page.keyboard.down(key); await page.keyboard.down(second); await page.locator('#step').click();
    await expect(page.locator(`#state-${player}`)).toContainText('middle_high_punch_combo');
    await page.keyboard.up(key); await page.keyboard.up(second);
    await page.locator('#step').evaluate((b, n) => { for (let i = 0; i < n; i++) b.click(); }, startup);
    await expect(page.locator(`#hp-${1 - player}`)).toHaveText('935 / 1000');
    await page.locator('#boxes').click();
    await page.locator('#game').screenshot({ path: `${output}/p${player + 1}-contact.png` });
    await page.locator('#boxes').click();
    for (let i = 0; i < 180; i++) {
      if (await page.locator(`#hp-${1 - player}`).textContent() === '630 / 1000') break;
      if (await page.locator(`#hp-${1 - player}`).textContent() === '840 / 1000') await page.locator('#game').screenshot({path:`${output}/p${player+1}-second-contact.png`});
      await page.locator('#step').click();
    }
    await expect(page.locator(`#hp-${1 - player}`)).toHaveText('630 / 1000');
    await page.locator('#game').screenshot({ path: `${output}/p${player + 1}-third-contact.png` });
    await page.keyboard.up(back);
    // Ohne Richtung bleibt H der normale linke Highkick.
    await page.locator('#reset').click(); await page.keyboard.down(key); await page.locator('#step').click(); await page.keyboard.up(key);
    await expect(page.locator(`#state-${player}`)).toContainText('standing_hk');
  }
  await page.locator('#animation-preview summary').click();
  await page.locator('#preview-animation').selectOption('middle_high_punch_combo');
  for (const facing of [1, -1]) {
  if(facing === -1) await page.locator('#preview-mirror').click();
  for (const frame of [0, 8, 17, 21, 24, 26, 29, 31, 35, 40, 46, 49, 53, 56, 58, 61, 63, 67, 73, 80, 86, 91, 96]) {
    await page.locator('#preview-time').fill(String(frame));
    await expect(page.locator('#preview-canvas')).toHaveAttribute('data-frame', frame.toFixed(2));
    await page.locator('#animation-preview').screenshot({ path: `${output}/preview-${facing}-${String(frame).padStart(2, '0')}.png` });
  }
  }
  if (errors.length) throw Error(`Seitenfehler: ${errors.join(' | ')}`);
  console.log(`Middle High Punch Smoke ok — Bilder in ${output}`);
} finally { await browser.close(); }
