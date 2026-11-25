// Wirbel (back + LP+LK+MK with a full Special bar), frame-stepped:
//  1. Versus with the real keyboard: without a full bar A+R+F+B stays the old
//     spin middle kick and the bar is untouched.
//  2. Versus as replays through the UI (the bar is part of the snapshot), both
//     sides, opponent standing or crouching: from bodies touching up to the
//     documented start distance the front hit lands (60 damage, knockdown), 3 px further
//     it whiffs. The bar is empty after the start.
//  3. Training as a replay: the move starts, the dummy falls without damage.
//  4. Survival: deterministic check in the page (one enemy in front, one
//     behind, every type), then the real run: the player fills the Special bar
//     with own hits and spins with enemies around.
//  5. Combo list and animation preview (every key pose, both facings).
// Screenshots in test-results/special-spin.
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { TEST_URL, chromeExecutable } from './smoke-env.mjs';
const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true, args: ['--no-sandbox'] });
const output = 'test-results/special-spin'; await mkdir(output, { recursive: true });
/**
 * Documented front start distance (centre to centre, px) per defender stance;
 * bodies touch at 32 px. Holding back walks the attacker 2 px away on the input
 * frame, so this is 2 px below the reach at attack start (89 / 81 px, unit test).
 */
const RANGE = { standing: [32, 87], crouching: [32, 79] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(TEST_URL);
  await page.locator('#game[data-ready="true"]').waitFor();
  await page.locator('#pause').click(); await page.locator('#states').click();
  const steps = n => page.locator('#step').evaluate((b, count) => { for (let i = 0; i < count; i++) b.click(); }, n);
  const hp = async player => Number((await page.locator(`#hp-${player}`).textContent()).split(' / ')[0]);
  const bar = player => page.locator(`#resource-value-${player}-special`);
  const ensurePaused = async () => { if ((await page.locator('#pause').textContent()).match(/Pause/)) await page.locator('#pause').click(); };

  // ---------------------------------------------------------- 1. versus ----
  await page.locator('#reset').click();
  await steps(2);
  await page.keyboard.down('a'); for (const key of ['r', 'f', 'b']) await page.keyboard.down(key);
  await page.locator('#step').click();
  await expect(page.locator('#state-0')).toContainText('spin_mk');
  for (const key of ['r', 'f', 'b', 'a']) await page.keyboard.up(key);
  await expect(bar(0)).toHaveText('0 / 100');

  // ------------------------------------------- 2./3. replays: versus, training ----
  const replay = (attacker, distance, crouch, training = false) => page.evaluate(async ({ attacker, distance, crouch, training }) => {
    const { createGame } = await import('/src/simulation/state.ts');
    const { createReplay } = await import('/src/debug/replay.ts');
    const { buttonBit } = await import('/src/input/types.ts');
    const game = createGame(), [a, b] = game.fighters;
    a.x = 400 * 256; b.x = a.x + distance * 256;
    if (training) game.training = { enabled: true, dummy: 'stand' };
    game.fighters[attacker].resources.special.current = 100;
    const replay = createReplay(game), n = { up: false, down: false, left: false, right: false, buttons: 0 };
    const keys = buttonBit('LP') | buttonBit('LK') | buttonBit('MK');
    // P1 faces right (back = left), P2 faces left (back = right).
    const chord = { ...n, left: attacker === 0, right: attacker === 1, buttons: keys }, defend = { ...n, down: crouch };
    for (let i = 0; i < 100; i++) {
      const own = i === 4 ? chord : n;
      replay.frames.push({ inputs: attacker === 0 ? [own, defend] : [defend, own], events: [] });
    }
    return replay;
  }, { attacker, distance, crouch, training });
  const load = async (data, name) => {
    await page.locator('#replay-file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await page.locator('#play').click(); await ensurePaused();
  };
  for (const attacker of [0, 1]) for (const stance of ['standing', 'crouching']) {
    const [min, max] = RANGE[stance];
    for (const [distance, want] of [[min, 60], [max, 60], [max + 3, 0]]) {
      await load(await replay(attacker, distance, stance === 'crouching'), 'wirbel.json');
      await steps(6);
      await expect(page.locator(`#state-${attacker}`)).toContainText('special_spin');
      await expect(bar(attacker)).toHaveText('0 / 100');
      await steps(13);
      await page.locator('#game').screenshot({ path: `${output}/range-p${attacker + 1}-${stance}-${distance}-front.png` });
      let knocked = false;
      for (let i = 0; i < 20; i++) { await steps(1); knocked ||= (await page.locator(`#state-${1 - attacker}`).textContent()).includes('Knockdown'); }
      await steps(60);
      expect(1000 - await hp(1 - attacker), `P${attacker + 1} ${stance} ${distance} px`).toBe(want);
      expect(knocked, `P${attacker + 1} ${stance} ${distance} px: knockdown`).toBe(want > 0);
      await page.locator('#play').click();
    }
  }
  await load(await replay(0, 50, false, true), 'wirbel-training.json');
  await expect(page.locator('#timer')).toHaveText('∞');
  await steps(6);
  await expect(page.locator('#state-0')).toContainText('special_spin');
  let trainingKnockdown = false;
  for (let i = 0; i < 40; i++) { await steps(1); trainingKnockdown ||= (await page.locator('#state-1').textContent()).includes('Knockdown'); }
  expect(trainingKnockdown).toBe(true);
  expect(await hp(1)).toBe(1000);
  await page.locator('#game').screenshot({ path: `${output}/training.png` });
  await page.locator('#play').click();

  // ------------------------------------------------------------ 4. survival ----
  // Deterministic, in the page with the shipped modules: one enemy in front, one behind.
  const surrounded = await page.evaluate(async () => {
    const { createSurvival, spawnEnemy, stepSurvival } = await import('/src/survival/state.ts');
    const { SURVIVAL } = await import('/src/survival/config.ts');
    const { buttonBit } = await import('/src/input/types.ts');
    const n = { up: false, down: false, left: false, right: false, buttons: 0 }, result = {};
    for (const kind of Object.keys(SURVIVAL.types)) {
      const s = createSurvival(5); s.spawnTimer = 1e9; s.flow.bossTimer = 1e9; s.flow.waveTimer = 1e9;
      const place = offset => {
        const e = spawnEnemy(s, Math.sign(offset), kind); e.entering = false;
        e.fighter.x = s.player.x + offset * 256; e.fighter.facing = e.fighter.attackFacing = -Math.sign(offset);
        return e;
      };
      const front = place(50), back = place(-50);
      s.player.resources.special.current = 100;
      stepSurvival(s, { ...n, left: true, buttons: buttonBit('LP') | buttonBit('LK') | buttonBit('MK') });
      const down = new Set();
      for (let i = 0; i < 90; i++) { stepSurvival(s, n); for (const e of [front, back]) if (e.fighter.state === 'Knockdown') down.add(e.uid); }
      result[kind] = [front.fighter.hp < SURVIVAL.types[kind].hp, back.fighter.hp < SURVIVAL.types[kind].hp, down.has(front.uid), down.has(back.uid), s.player.facing];
    }
    return result;
  });
  for (const [kind, [frontHit, backHit, frontDown, backDown, facing]] of Object.entries(surrounded)) {
    expect([frontHit, backHit], kind).toEqual([true, true]);
    expect([frontDown, backDown], kind).toEqual(kind === 'heavy' ? [false, false] : [true, true]);
    expect(facing, `${kind}: no turn`).toBe(1);
  }
  // The real run: the player fills the Special bar with own hits (heavy punches at the enemy in front).
  const read = async () => {
    const [facing, , , over, , , , , front, hits, behind, struck] = (await page.locator('#game').getAttribute('data-survival')).split('|').map(Number);
    return { facing, over, front, hits, behind, struck };
  };
  const free = async () => /P1 {2}(Idle|Walk) /.test(await page.locator('#state-0').textContent());
  await page.keyboard.press('F10');
  await expect(page.locator('#match-status')).toContainText('SURVIVAL');
  await ensurePaused();
  await steps(1);
  await expect(page.locator('#game')).toHaveAttribute('data-survival', /\|/);
  // Auto-block guards the front; enemies behind are faced with a double tap.
  const autoBlock = page.locator('#auto-block'), autoWas = await autoBlock.getAttribute('aria-pressed');
  if (autoWas !== 'true') await autoBlock.click();
  // One round trip per decision: idle frames are stepped in the page until an
  // enemy is in reach of a free player (or the bar is full, or the run is over).
  const idleUntilTarget = () => page.evaluate(() => {
    const step = document.getElementById('step'), canvas = document.getElementById('game');
    for (let i = 0; i < 40; i++) {
      const [facing, , , over, , , , , front, , behind] = canvas.dataset.survival.split('|').map(Number);
      const full = document.getElementById('resource-value-0-special').textContent === '100 / 100';
      const free = /P1 {2}(Idle|Walk) /.test(document.getElementById('state-0').textContent);
      const turn = free && behind >= 0 && behind <= 55 && (front < 0 || front > behind);
      if (over || full || turn || (free && front >= 0 && front <= 70)) return { over: over === 1, full, turn, facing };
      step.click();
    }
    return { over: false, full: false, turn: false, facing: 0 };
  });
  const tap = async key => { await page.keyboard.down(key); await page.locator('#step').click(); await page.keyboard.up(key); await page.locator('#step').click(); };
  for (let run = 0, i = 0; i < 3000; i++) {
    const s = await idleUntilTarget();
    if (s.over) {
      if (++run >= 3) throw Error('Survival-Lauf dreimal vor vollem Special beendet.');
      await page.keyboard.press('Backspace'); await steps(2);
      continue;
    }
    if (s.full) break;
    if (s.turn) { const back = s.facing === 1 ? 'a' : 'd'; await tap(back); await tap(back); continue; }
    if (await free()) { await page.keyboard.down('y'); await page.locator('#step').click(); await page.keyboard.up('y'); }
  }
  await expect(bar(0)).toHaveText('100 / 100');
  await page.locator('#game').screenshot({ path: `${output}/survival-ready.png` });
  // Spin as soon as an enemy is close; preferably one on each side.
  let started = false, both = false;
  for (let i = 0; i < 3000 && !started; i++) {
    const s = await read();
    if (s.over) throw Error('Survival-Lauf vor dem Wirbel beendet.');
    const close = d => d >= 0 && d <= 65, wanted = close(s.front) && (close(s.behind) || i > 600);
    if (wanted && await free()) {
      const back = s.facing === 1 ? 'a' : 'd';
      both = close(s.behind);
      await page.keyboard.down(back); for (const key of ['r', 'f', 'b']) await page.keyboard.down(key);
      await page.locator('#step').click();
      for (const key of ['r', 'f', 'b', back]) await page.keyboard.up(key);
      started = (await page.locator('#state-0').textContent()).includes('special_spin');
      if (!started) await page.locator('#step').click();
    } else await page.locator('#step').click();
  }
  if (!started) throw Error('Wirbel im Survival nicht gestartet.');
  expect(Number((await bar(0).textContent()).split(' / ')[0])).toBeLessThan(20);
  await page.locator('#game').screenshot({ path: `${output}/survival-start.png` });
  let struck = 0;
  for (let i = 0; i < 60; i++) {
    await page.locator('#step').click();
    const s = await read();
    if (s.struck > struck) { struck = s.struck; await page.locator('#game').screenshot({ path: `${output}/survival-struck-${struck}.png` }); }
  }
  // Other enemies may interrupt the player in a real run; at least one side must land.
  expect(struck).toBeGreaterThanOrEqual(1);
  console.log(`Survival (echter Lauf): ${struck} Gegner getroffen${both ? ', Gegner auf beiden Seiten' : ''}`);
  if (autoWas !== 'true') await autoBlock.click();
  await page.keyboard.press('F10');

  // ---------------------------------------------------- 5. combo list, preview ----
  await expect(page.locator('#combo-list li[data-combo="special_spin"]')).toHaveCount(1);
  await expect(page.locator('#combo-list li[data-combo="special_spin"] .hint')).toContainText(/Special/);
  await expect(page.locator('#combo-list li[data-combo="special_spin"] .combo-command')).toContainText('LP + LK + MK');
  await page.locator('#animation-preview summary').click();
  await page.locator('#preview-animation').selectOption('special_spin');
  const frames = [0, 3, 6, 9, 11, 14, 17, 19, 24, 29, 32, 36, 41];
  for (const facing of [1, -1]) {
    if (facing === -1) await page.locator('#preview-mirror').click();
    for (const frame of frames) {
      await page.locator('#preview-time').fill(String(frame));
      await expect(page.locator('#preview-canvas')).toHaveAttribute('data-frame', frame.toFixed(2));
      await page.locator('#animation-preview').screenshot({ path: `${output}/preview-${facing}-${String(frame).padStart(2, '0')}.png` });
    }
  }
  if (errors.length) throw Error(`Seitenfehler: ${errors.join(' | ')}`);
  console.log(`Wirbel Smoke ok — Reichweite vorne ${RANGE.standing.join('–')} px (stehend), ${RANGE.crouching.join('–')} px (hockend); Bilder in ${output}`);
} finally { await browser.close(); }
