// Browser smoke for throws: the real keys (P1 C, P2 Numpad0) start both throws
// from ordinary walking, the throw effects are drawn in both themes, and the
// UI lists the new button (controls, settings, move list, input display).
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { TEST_URL, chromeExecutable } from './smoke-env.mjs';
const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true, args: ['--no-sandbox'] });
const output = 'test-results/throws'; await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(TEST_URL); await page.locator('#game[data-ready="true"]').waitFor();

  // UI: key caps, settings button, move list (EN and DE).
  await expect(page.locator('.controls kbd[data-owner="0"][data-control="THROW"]')).toHaveText(/^C$/i);
  await expect(page.locator('.controls kbd[data-owner="1"][data-control="THROW"]')).toHaveText(/0/);
  await page.locator('#settings-details summary').click();
  await expect(page.locator('#settings [data-player="0"][data-action="THROW"]')).toContainText('Throw');
  await page.locator('#settings-details summary').click();
  await page.locator('#combo-list summary').click();
  await expect(page.locator('#combo-list [data-combo="throw_forward"]')).toContainText('Hip Throw');
  await expect(page.locator('#combo-list [data-combo="throw_back"]')).toContainText('Shoulder Throw');
  await page.locator('#language').click();
  await expect(page.locator('#combo-list [data-combo="throw_back"]')).toContainText('Schulterwurf');
  await expect(page.locator('#combo-list')).toContainText('Würfe');
  await page.locator('#language').click();
  await page.locator('#combo-list summary').click();

  const steps = n => page.locator('#step').evaluate((b, n) => { for (let i = 0; i < n; i++) b.click(); }, n);
  const canvasHash = () => page.locator('#game').evaluate(canvas => { let h = 0; const d = canvas.toDataURL(); for (let i = 0; i < d.length; i += 7) h = (h * 31 + d.charCodeAt(i)) | 0; return h; });
  const ensurePaused = async () => { if ((await page.locator('#pause').textContent()).match(/Pause/)) await page.locator('#pause').click(); };
  const stepUntil = async (locator, text, limit = 90) => {
    for (let i = 0; i < limit && !(await page.locator(locator).textContent()).includes(text); i++) await page.locator('#step').click();
    await expect(page.locator(locator)).toContainText(text);
  };
  await page.keyboard.press('F2'); // input display
  for (const theme of ['dark', 'light']) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.locator('#theme').click();
    await ensurePaused();
    await page.locator('#reset').click();
    // Both walk in until the pushboxes touch.
    await page.keyboard.down('d'); await page.keyboard.down('ArrowLeft'); await steps(70);
    await page.keyboard.up('ArrowLeft');
    // P1: forward (D) + C → hip throw.
    await page.keyboard.down('c'); await page.locator('#step').click(); await page.keyboard.up('c'); await page.keyboard.up('d');
    await expect(page.locator('#state-0')).toContainText('throw_forward');
    await expect(page.locator('#input-0')).toContainText('+THROW');
    await stepUntil('#state-1', 'Thrown', 10);
    await steps(8);
    await page.locator('#game').screenshot({ path: `${output}/${theme}-hip-throw-air.png` });
    await stepUntil('#hp-1', '890 / 1000');
    await expect(page.locator('#state-1')).toContainText('Knockdown');
    await page.waitForTimeout(80);
    await page.locator('#game').screenshot({ path: `${output}/${theme}-hip-throw-impact.png` });
    // The impact frame differs only by the effects: switching them off must change the canvas.
    const withEffects = await canvasHash();
    await page.locator('#settings-details summary').click(); await page.locator('#effects-toggle').uncheck();
    await page.waitForTimeout(80);
    const without = await canvasHash();
    await page.locator('#effects-toggle').check(); await page.locator('#settings-details summary').click();
    if (withEffects === without) throw Error(`${theme}: throw effects not visible on the impact frame`);
    // Wait until both stand again, then P2: back (→) + Numpad0 → shoulder throw with side switch.
    await stepUntil('#state-1', 'Idle', 90);
    await stepUntil('#state-0', 'Idle', 90);
    const p2Facing = await page.evaluate(() => document.querySelector('#state-1').textContent);
    await page.keyboard.down('ArrowLeft'); await steps(20); await page.keyboard.up('ArrowLeft');
    // P2 stands on the right and faces left: back is the right arrow.
    const right = 'ArrowRight';
    await page.keyboard.down(right); await page.keyboard.down('Numpad0'); await page.locator('#step').click();
    await page.keyboard.up('Numpad0'); await page.keyboard.up(right);
    await expect(page.locator('#state-1')).toContainText('throw_back', { timeout: 2000 }).catch(async error => { throw Error(`P2 throw did not start (${p2Facing.split('\n')[0]}): ${error.message}`); });
    await expect(page.locator('#input-1')).toContainText('+THROW');
    await stepUntil('#state-0', 'Thrown', 10);
    await steps(14);
    await page.locator('#game').screenshot({ path: `${output}/${theme}-shoulder-throw-air.png` });
    await stepUntil('#hp-0', '870 / 1000');
    await page.locator('#game').screenshot({ path: `${output}/${theme}-shoulder-throw-impact.png` });
  }
  if (errors.length) throw Error(`Seitenfehler: ${errors.join(' | ')}`);
  console.log(`Throws Smoke ok — Bilder in ${output}`);
} finally { await browser.close(); }
