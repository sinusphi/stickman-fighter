// Survival mode: start with F10, enemies spawn and attack, double tap backwards
// turns the player, back attackers show their warning, Backspace starts a new
// run, the first miniboss shows up after 30 s of run time (HUD, boss bar), F10
// returns to versus. Screenshots in test-results/survival.
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { TEST_URL, chromeExecutable } from './smoke-env.mjs';
const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true, args: ['--no-sandbox'] });
const output = 'test-results/survival'; await mkdir(output, { recursive: true });
const read = async page => {
  const value = await page.locator('#game').getAttribute('data-survival');
  if (!value) return null;
  const [facing, enemies, warnings, over, turns, boss, bosses, energy] = value.split('|').map(Number);
  return { facing, enemies, warnings, over, turns, boss, bosses, energy };
};
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(TEST_URL);
  await page.locator('#game[data-ready="true"]').waitFor();
  await page.keyboard.press('F10');
  await expect(page.locator('#match-status')).toContainText('SURVIVAL');
  await expect(page.locator('#survival')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#training')).toBeDisabled();
  await expect.poll(async () => (await read(page))?.enemies ?? 0, { timeout: 8000 }).toBeGreaterThanOrEqual(3);
  await expect(page.locator('#timer')).not.toHaveText('0:00');
  await expect(page.locator('#p2-label')).toContainText(/ENEMIES|GEGNER/);
  await page.locator('#game').screenshot({ path: `${output}/crowd.png` });

  // Double tap backwards (A while facing right), frame by frame.
  await page.locator('#pause').click();
  const step = n => page.locator('#step').evaluate((b, count) => { for (let i = 0; i < count; i++) b.click(); }, n);
  // Enemies may hit the player in between; retry until the player was free for the double tap.
  let turned = null;
  for (let attempt = 0; attempt < 6 && !turned; attempt++) {
    await step(40);
    const before = await read(page), key = before.facing === 1 ? 'a' : 'd';
    await page.keyboard.down(key); await step(1); await page.keyboard.up(key); await step(2);
    await page.keyboard.down(key); await step(1); await page.keyboard.up(key); await step(3);
    await page.locator('#game').screenshot({ path: `${output}/turning.png` });
    await step(10);
    const after = await read(page);
    if (after.turns > before.turns) { expect(after.facing).toBe(-before.facing); turned = after; }
  }
  if (!turned) throw Error('Doppeltipp nach hinten hat den Spieler nicht umgedreht.');
  await page.locator('#game').screenshot({ path: `${output}/turned.png` });

  // A back attack with its warning.
  await page.locator('#pause').click();
  await expect.poll(async () => (await read(page))?.warnings ?? 0, { timeout: 25000, intervals: [50] }).toBeGreaterThan(0);
  await page.locator('#game').screenshot({ path: `${output}/back-warning.png` });

  await page.keyboard.press('Backspace');
  await expect.poll(async () => (await page.locator('#timer').textContent()), { timeout: 3000 }).toMatch(/^0:0[0-2]$/);

  // Miniboss: paused and stepped, so the run does not depend on real time (the player stays idle).
  await page.locator('#pause').click();
  let bossFrames = 0;
  for (; bossFrames < 3000 && !(await read(page)).boss; bossFrames += 100) { await step(100); await page.waitForTimeout(60); }
  const fight = await read(page);
  if (!fight.boss) throw Error('Der erste Miniboss ist nicht erschienen.');
  if (bossFrames < 1700) throw Error(`Miniboss zu früh: nach ${bossFrames} Frames.`);
  expect(fight.bosses).toBe(1);
  await expect(page.locator('#arena-mode')).toContainText('BOSS 1');
  await step(240); await page.waitForTimeout(100);
  await page.locator('#game').screenshot({ path: `${output}/miniboss.png` });
  expect((await read(page)).bosses).toBe(1);
  await page.locator('#pause').click();

  await page.keyboard.press('F10');
  await expect(page.locator('#match-status')).toContainText('LOCAL VERSUS');
  await expect(page.locator('#survival')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => await read(page)).toBeNull();
  if (errors.length) throw Error(`Seitenfehler: ${errors.join(' | ')}`);
  console.log(`Survival Smoke ok — Bilder in ${output}`);
} finally { await browser.close(); }
