// Guard break and the training "bar full" options, frame-stepped with the real keyboard:
//  1. Training: both checkboxes are disabled outside training; with training on,
//     "Revenge always full" fills both Revenge bars on the next frame.
//  2. Dummy "Always block": P1 walks in and starts the Revenge combo (S, S+D, D,
//     D+R). The opener meets the guard: P2 stays in Blockstun for the 30-frame
//     freeze (screenshots early, middle, late), then the strike breaks through,
//     P2 is in Hitstun and all seven hits land.
//  3. The bar is full again right after the start, so a second combo follows;
//     with the option off the bar is spent.
// Screenshots in test-results/guard-break.
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { TEST_URL, chromeExecutable } from './smoke-env.mjs';
const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true, args: ['--no-sandbox'] });
const output = 'test-results/guard-break'; await mkdir(output, { recursive: true });
const FREEZE = 30;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(TEST_URL);
  await page.locator('#game[data-ready="true"]').waitFor();
  await page.locator('#pause').click(); await page.locator('#states').click();
  const step = () => page.locator('#step').click();
  const steps = n => page.locator('#step').evaluate((b, count) => { for (let i = 0; i < count; i++) b.click(); }, n);
  const state = player => page.locator(`#state-${player}`).textContent();
  const hitstop = async () => Number((await state(0)).match(/Hitstop (\d+)f/)[1]);
  const bar = (player, name = 'revenge') => page.locator(`#resource-value-${player}-${name}`);
  async function quarterCircle() {
    await page.keyboard.down('s'); await step();
    await page.keyboard.down('d'); await step();
    await page.keyboard.up('s'); await step();
    await page.keyboard.down('r'); await step();
    await page.keyboard.up('r'); await page.keyboard.up('d');
  }

  // ------------------------------------------------- 1. training options ----
  await expect(page.locator('#full-revenge')).toBeDisabled();
  await expect(page.locator('#full-special')).toBeDisabled();
  await page.keyboard.press('F4');
  await expect(page.locator('#timer')).toHaveText('∞');
  await page.keyboard.press('F5'); await page.keyboard.press('F5');
  await expect(page.locator('#dummy')).toContainText('Always block');
  await expect(page.locator('#full-revenge')).toBeEnabled();
  await expect(bar(0)).toHaveText('0 / 100');
  await page.locator('#full-revenge').check();
  await expect(page.locator('#full-revenge')).toBeChecked();
  await expect(page.locator('#full-special')).not.toBeChecked();
  await step();
  await expect(bar(0)).toHaveText('100 / 100');
  await expect(bar(1)).toHaveText('100 / 100');
  await expect(bar(0, 'special')).toHaveText('0 / 100');

  // ----------------------------------------------------- 2. guard break -----
  // Walk in to about 60 px.
  await page.keyboard.down('d'); await steps(100); await page.keyboard.up('d'); await steps(10);
  await quarterCircle();
  await expect(page.locator('#state-0')).toContainText('revenge_combo');
  let frozen = 0;
  for (let i = 0; i < 40 && frozen === 0; i++) {
    await step();
    if ((await state(1)).includes('Blockstun') && await hitstop() >= FREEZE - 1) frozen = await hitstop();
  }
  if (!frozen) throw Error('No guard break: the dummy never froze in Blockstun.');
  await page.locator('#game').screenshot({ path: `${output}/freeze-start.png` });
  const moveFrame = (await state(0)).match(/Move (\d+)\//)[1];
  await steps(Math.floor(frozen / 2));
  await expect(page.locator('#state-1')).toContainText('Blockstun');
  expect((await state(0)).match(/Move (\d+)\//)[1]).toBe(moveFrame);
  await page.locator('#game').screenshot({ path: `${output}/freeze-middle.png` });
  await steps(frozen - Math.floor(frozen / 2) - 2);
  await page.locator('#game').screenshot({ path: `${output}/freeze-late.png` });
  await steps(2);
  await expect(page.locator('#state-1')).toContainText('Hitstun');
  await page.locator('#game').screenshot({ path: `${output}/breakthrough.png` });
  // The rest of the combo: P2 never blocks again and is never free before the last hit.
  let finished = false;
  for (let i = 0; i < 260 && !finished; i++) {
    await step();
    const p1 = await state(0), p2 = await state(1);
    if (!p1.includes('revenge_combo')) finished = true;
    else if (/Blockstun|Idle|Walk/.test(p2.split('\n')[0])) throw Error(`P2 escaped the locked combo: ${p2.split('\n')[0]}`);
  }
  expect(finished).toBe(true);
  await expect(bar(0)).toHaveText('100 / 100');

  // ------------------------------------------- 3. refill and option off ----
  await steps(60);
  await page.keyboard.down('d'); await steps(30); await page.keyboard.up('d'); await steps(5);
  await quarterCircle();
  await expect(page.locator('#state-0')).toContainText('revenge_combo');
  await steps(200);
  await page.locator('#full-revenge').uncheck();
  await step();
  await expect(page.locator('#full-revenge')).not.toBeChecked();
  await steps(30);
  await page.keyboard.down('d'); await steps(30); await page.keyboard.up('d'); await steps(5);
  await quarterCircle();
  await expect(page.locator('#state-0')).toContainText('revenge_combo');
  await step();
  await expect(bar(0)).toHaveText('0 / 100');
  expect(errors).toEqual([]);
  console.log('guard-break smoke ok');
} finally { await browser.close(); }
