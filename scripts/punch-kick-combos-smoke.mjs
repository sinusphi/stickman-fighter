// Browser smoke for the forward MP+RHK and back MK+HP combos: real key input
// for both players (both facings), both hits in order, combo list and preview.
import { chromium } from '@playwright/test';
import { expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { TEST_URL, chromeExecutable } from './smoke-env.mjs';
const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true, args: ['--no-sandbox'] });
const output = 'test-results/punch-kick-combos'; await mkdir(output, { recursive: true });
// [player, forward, back, MP, RHK, MK, HP] with the default bindings (P1 starts left).
const PLAYERS = [[0, 'd', 'a', 't', 'n', 'b', 'y'], [1, 'ArrowLeft', 'ArrowRight', 'Numpad8', 'Numpad3', 'Numpad2', 'Numpad9']];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(TEST_URL);
  await page.locator('#game[data-ready="true"]').waitFor();
  await page.locator('#pause').click(); await page.locator('#states').click();
  const steps = n => page.locator('#step').evaluate((b, n) => { for (let i = 0; i < n; i++) b.click(); }, n);
  for (const [player, forward, back, mp, rhk, mk, hp] of PLAYERS) {
    for (const [id, direction, keys, first] of [['punch_kick_combo', forward, [mp, rhk], '945 / 1000'], ['kick_punch_combo', back, [mk, hp], '935 / 1000']]) {
      await page.locator('#reset').click();
      // Walk into range of both hits.
      await page.keyboard.down(forward); await steps(105); await page.keyboard.up(forward);
      await page.keyboard.down(direction); for (const key of keys) await page.keyboard.down(key);
      await page.locator('#step').click();
      await expect(page.locator(`#state-${player}`)).toContainText(id);
      for (const key of keys) await page.keyboard.up(key);
      await page.keyboard.up(direction);
      let shot = false;
      for (let i = 0; i < 120; i++) {
        const text = await page.locator(`#hp-${1 - player}`).textContent();
        if (text === first && !shot) { await page.locator('#game').screenshot({ path: `${output}/${id}-p${player + 1}-first.png` }); shot = true; }
        if (text === '850 / 1000') break;
        await page.locator('#step').click();
      }
      expect(shot, `${id}: first hit`).toBe(true);
      await expect(page.locator(`#hp-${1 - player}`)).toHaveText('850 / 1000');
      await page.locator('#game').screenshot({ path: `${output}/${id}-p${player + 1}-second.png` });
    }
    // Without a direction the keys stay single moves.
    await page.locator('#reset').click(); await page.keyboard.down(mp); await page.locator('#step').click(); await page.keyboard.up(mp);
    await expect(page.locator(`#state-${player}`)).toContainText('standing_mp');
  }
  for (const id of ['punch_kick_combo', 'kick_punch_combo']) await expect(page.locator(`#combo-list li[data-combo="${id}"]`)).toHaveCount(1);
  await page.locator('#animation-preview summary').click();
  for (const [id, frames] of [['punch_kick_combo', [0, 5, 8, 12, 14, 16, 18, 20, 24, 28, 33]], ['kick_punch_combo', [0, 8, 15, 17, 21, 25, 28, 30, 36, 43, 46]]]) {
    await page.locator('#preview-animation').selectOption(id);
    for (const facing of [1, -1]) {
      const mirrored = await page.locator('#preview-mirror').getAttribute('aria-pressed') === 'true';
      if (mirrored !== (facing === -1)) await page.locator('#preview-mirror').click();
      for (const frame of frames) {
        await page.locator('#preview-time').fill(String(frame));
        await expect(page.locator('#preview-canvas')).toHaveAttribute('data-frame', frame.toFixed(2));
        await page.locator('#animation-preview').screenshot({ path: `${output}/preview-${id}-${facing}-${String(frame).padStart(2, '0')}.png` });
      }
    }
  }
  if (errors.length) throw Error(`Seitenfehler: ${errors.join(' | ')}`);
  console.log(`Punch/Kick Combo Smoke ok — Bilder in ${output}`);
} finally { await browser.close(); }
