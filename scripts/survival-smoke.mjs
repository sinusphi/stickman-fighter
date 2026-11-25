// Survival mode: start with F10, enemies spawn and attack, double tap backwards
// turns the player, back attackers show their warning, Backspace starts a new
// run, the player throws an enemy (6 + C), the first miniboss shows up after
// 30 s of run time (HUD, boss bar) and shrugs a throw off, F10 returns to versus.
// Upgrades (with `?survival-test=weak-boss`: an early 1-hp miniboss): the fallen
// boss opens the choice with three cards, the run stands still, a digit key or
// the player's own controls (← → plus an attack button) pick, the badge shows
// up and the damage upgrade reaches the player. Screenshots in test-results/survival.
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { TEST_URL, chromeExecutable } from './smoke-env.mjs';
const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true, args: ['--no-sandbox'] });
const output = 'test-results/survival'; await mkdir(output, { recursive: true });
const read = async page => {
  const value = await page.locator('#game').getAttribute('data-survival');
  if (!value) return null;
  const [facing, enemies, warnings, over, turns, boss, bosses, energy, front, , , , thrown, shrugs] = value.split('|').map(Number);
  return { facing, enemies, warnings, over, turns, boss, bosses, energy, front, thrown, shrugs };
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

  // Throws (paused, frame by frame): walk up to the nearest enemy in front and throw it with
  // forward + C. `done` tells when the attempt counts (enemy held, or boss shrugged it off).
  const throwNearest = async (done, tries = 40) => {
    for (let i = 0; i < tries; i++) {
      const now = await read(page), forward = now.facing === 1 ? 'd' : 'a';
      if (now.front < 0 || now.front > 46) { await page.keyboard.down(forward); await step(3); await page.keyboard.up(forward); await step(1); continue; }
      await page.keyboard.down(forward); await page.keyboard.down('c'); await step(1);
      await page.keyboard.up('c'); await page.keyboard.up(forward);
      for (let f = 0; f < 12; f++) { await step(1); const after = await read(page); if (done(now, after)) return after; }
      await step(30);
    }
    return null;
  };
  await page.locator('#pause').click();
  await step(150);
  const held = await throwNearest((_, after) => after.thrown > 0);
  if (!held) throw Error('Der Spieler hat keinen Gegner geworfen.');
  await page.locator('#game').screenshot({ path: `${output}/throw.png` });
  await step(60);
  expect((await read(page)).thrown).toBe(0);
  await page.locator('#pause').click();
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
  // The miniboss shrugs every throw off.
  const shrugged = await throwNearest((before, after) => after.shrugs > before.shrugs, 60);
  if (!shrugged) throw Error('Der Miniboss hat keinen Wurf abgeschüttelt.');
  expect(shrugged.thrown).toBe(0);
  await step(2);
  await page.locator('#game').screenshot({ path: `${output}/boss-shrug.png` });
  await page.locator('#pause').click();

  await page.keyboard.press('F10');
  await expect(page.locator('#match-status')).toContainText('LOCAL VERSUS');
  await expect(page.locator('#survival')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => await read(page)).toBeNull();

  // Side P2: the run is steered with the P2 controls (arrows), auto block works for the player.
  await page.locator('#side').click();
  await expect(page.locator('#side')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('F10');
  await expect(page.locator('#match-status')).toContainText('SURVIVAL');
  await expect(page.locator('#p1-label')).toContainText('PLAYER 02');
  const autoBlock = page.locator('#auto-block'), autoWas = await autoBlock.getAttribute('aria-pressed');
  if (autoWas !== 'true') await autoBlock.click();
  await expect(autoBlock).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#pause').click();
  let turnedP2 = false;
  for (let attempt = 0; attempt < 6 && !turnedP2; attempt++) {
    await step(40);
    const before = await read(page), key = before.facing === 1 ? 'ArrowLeft' : 'ArrowRight';
    await page.keyboard.down(key); await step(1); await page.keyboard.up(key); await step(2);
    await page.keyboard.down(key); await step(1); await page.keyboard.up(key); await step(13);
    turnedP2 = (await read(page)).turns > before.turns;
  }
  if (!turnedP2) throw Error('P2-Steuerung dreht den Survival-Spieler nicht.');
  await page.locator('#pause').click();
  if (autoWas !== 'true') await autoBlock.click();
  await page.keyboard.press('F10');
  await page.locator('#side').click();
  await expect(page.locator('#side')).toHaveAttribute('aria-pressed', 'false');

  // ---- Upgrades after a miniboss (weak test boss: 1 hp, after 2 s).
  const upgrades = async () => {
    const value = await page.locator('#game').getAttribute('data-upgrades');
    if (value === null) return null;
    const [offer, cursor, picks, damage] = value.split('|');
    return { offer: offer ? offer.split(',') : [], cursor: Number(cursor), picks: picks ? picks.split(',') : [], damage: Number(damage) };
  };
  const tap = async (key, ms = 60) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };
  /** Fells the weak boss with jabs (walking up to it) and waits for the choice. */
  const reachChoice = async () => {
    await expect.poll(async () => (await read(page))?.boss ?? 0, { timeout: 8000 }).toBeGreaterThan(0);
    for (let i = 0; i < 200 && (await read(page)).boss; i++) { await tap('d', 70); await tap('r', 50); await page.waitForTimeout(40); }
    const fallen = await read(page);
    if (fallen.boss || fallen.bosses !== 1) throw Error('Der schwache Test-Miniboss ist nicht gefallen.');
    await expect.poll(async () => (await upgrades()).offer.length, { timeout: 8000 }).toBe(3);
    return upgrades();
  };
  await page.goto(`${TEST_URL}/?survival-test=weak-boss`);
  await page.locator('#game[data-ready="true"]').waitFor();
  await page.keyboard.press('F10');
  await expect(page.locator('#match-status')).toContainText('SURVIVAL');
  const first = await reachChoice();
  expect(new Set(first.offer).size).toBe(3);
  expect(first.picks).toEqual([]);
  // The run stands still while the cards are open.
  const frozen = await page.locator('#timer').textContent();
  await page.waitForTimeout(700);
  expect(await page.locator('#timer').textContent()).toBe(frozen);
  await page.locator('#game').screenshot({ path: `${output}/upgrade-choice.png` });
  // Digit key 3 takes the third card at once.
  await page.keyboard.press('Digit3');
  await expect.poll(async () => (await upgrades()).picks, { timeout: 2000 }).toEqual([first.offer[2]]);
  expect((await upgrades()).offer).toEqual([]);
  await expect(page.locator('#notice')).toContainText('Upgrade');
  await expect.poll(async () => await page.locator('#timer').textContent(), { timeout: 3000 }).not.toBe(frozen);
  await page.locator('#game').screenshot({ path: `${output}/upgrade-badge.png` });

  // New run: same seed is not guaranteed (match seed), but the flow repeats; this time with the controls.
  await page.keyboard.press('Backspace');
  await expect.poll(async () => (await upgrades())?.picks.length ?? -1, { timeout: 3000 }).toBe(0);
  const second = await reachChoice();
  // Held/mashed presses right after opening are ignored (short lock), then → moves, ← moves back, an attack button picks.
  await page.waitForTimeout(600);
  const start = (await upgrades()).cursor;
  expect(start).toBe(1);
  await tap('d'); await expect.poll(async () => (await upgrades()).cursor).toBe(2);
  await tap('a'); await page.waitForTimeout(100); await tap('a'); await expect.poll(async () => (await upgrades()).cursor).toBe(0);
  await page.locator('#game').screenshot({ path: `${output}/upgrade-cursor.png` });
  await tap('r', 120);
  await expect.poll(async () => (await upgrades()).picks, { timeout: 2000 }).toEqual([second.offer[0]]);
  if (second.offer[0] === 'damage') expect((await upgrades()).damage).toBeGreaterThan(1000);
  await page.keyboard.press('F10');
  await expect.poll(async () => await upgrades()).toBeNull();

  if (errors.length) throw Error(`Seitenfehler: ${errors.join(' | ')}`);
  console.log(`Survival Smoke ok — Bilder in ${output}`);
} finally { await browser.close(); }
