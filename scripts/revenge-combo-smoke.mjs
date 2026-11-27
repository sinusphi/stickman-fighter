// Revenge combo (quarter circle forward 236 + LP with a full Revenge bar), frame-stepped:
//  1. Versus with the real keyboard: without a full bar 236 + LP stays the jab;
//     P2 fills P1's bar with real hits; with the full bar the old chord D+F+G+H
//     stays the spin high kick and keeps the bar; P1 (S, S+D, D, D+R) lands all
//     seven hits and spends the bar; the 500 damage fill P2's bar, P2 (↓, ↓+←,
//     ←, ←+Num7) answers with all seven.
//  2. Start distances (centre to centre) as replays through the UI, both sides,
//     opponent standing or crouching: from bodies touching (38 px) up to the
//     opener's maximum reach (93 px standing, 86 px crouching) all seven hits
//     land; 3 px further the jab whiffs.
//  3. Survival: deterministic check in the page (heavy enemy, boss), then the
//     real run: the enemies fill the bar, the combo starts on the next enemy in
//     front and spends the bar.
//  4. Animation preview: every frame with a pose change, both facings.
// Screenshots in test-results/revenge-combo.
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { TEST_URL, chromeExecutable } from './smoke-env.mjs';
const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true, args: ['--no-sandbox'] });
const output = 'test-results/revenge-combo'; await mkdir(output, { recursive: true });
/** Documented start distances in px: [min, max] per defender stance. */
const RANGE = { standing: [38, 93], crouching: [38, 86] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(TEST_URL);
  await page.locator('#game[data-ready="true"]').waitFor();
  await page.locator('#pause').click(); await page.locator('#states').click();
  const steps = n => page.locator('#step').evaluate((b, count) => { for (let i = 0; i < count; i++) b.click(); }, n);
  const hp = async player => Number((await page.locator(`#hp-${player}`).textContent()).split(' / ')[0]);
  const bar = player => page.locator(`#resource-value-${player}-revenge`);
  const ensurePaused = async () => { if ((await page.locator('#pause').textContent()).match(/Pause/)) await page.locator('#pause').click(); };
  /** Quarter circle forward + LP with the real keyboard, one frame per step. */
  async function quarterCircle(down, forward, lp) {
    await page.keyboard.down(down); await page.locator('#step').click();
    await page.keyboard.down(forward); await page.locator('#step').click();
    await page.keyboard.up(down); await page.locator('#step').click();
    await page.keyboard.down(lp); await page.locator('#step').click();
    await page.keyboard.up(lp); await page.keyboard.up(forward);
  }
  /** Steps until `player`'s combo is over; a screenshot at every landed hit. Returns the hits. */
  async function watchCombo(player, prefix) {
    const defender = 1 - player;
    let last = await hp(defender), hits = 0;
    for (let i = 0; i < 260 && hits < 7; i++) {
      await page.locator('#step').click();
      const now = await hp(defender);
      if (now < last) { hits++; last = now; await page.locator('#game').screenshot({ path: `${output}/${prefix}-hit-${hits}.png` }); }
      if (!(await page.locator(`#state-${player}`).textContent()).includes('revenge_combo') && i > 10) break;
    }
    return hits;
  }

  // ---------------------------------------------------------- 1. versus ----
  await page.locator('#reset').click();
  await steps(2);
  // Without a full bar the quarter circle + LP stays the jab.
  await quarterCircle('s', 'd', 'r');
  await expect(page.locator('#state-0')).toContainText('standing_lp');
  await expect(bar(0)).toHaveText('0 / 100');
  await page.locator('#reset').click();
  // P2 walks in and hits P1 (forward chord H+N twice, then jabs) until P1's bar is full.
  await page.keyboard.down('ArrowLeft'); await steps(110); await page.keyboard.up('ArrowLeft');
  for (let round = 0; round < 40 && await bar(0).textContent() !== '100 / 100'; round++) {
    await page.keyboard.down('ArrowLeft'); await page.keyboard.down('Numpad6'); await page.keyboard.down('Numpad3'); await page.locator('#step').click();
    await page.keyboard.up('Numpad6'); await page.keyboard.up('Numpad3'); await page.keyboard.up('ArrowLeft');
    await steps(150);
    if (await bar(0).textContent() === '100 / 100') break;
    await page.keyboard.down('ArrowLeft'); await steps(30); await page.keyboard.up('ArrowLeft');
    await page.keyboard.down('Numpad7'); await page.locator('#step').click(); await page.keyboard.up('Numpad7'); await steps(40);
  }
  await expect(bar(0)).toHaveText('100 / 100');
  await expect(page.locator('#resource-ready-0-revenge')).toHaveClass(/is-visible/);
  await steps(90);
  // The old chord no longer spends the bar: it stays the spin high kick.
  await page.keyboard.down('d'); for (const key of ['f', 'g', 'h']) await page.keyboard.down(key);
  await page.locator('#step').click();
  await expect(page.locator('#state-0')).toContainText('spin_hk');
  for (const key of ['f', 'g', 'h', 'd']) await page.keyboard.up(key);
  await expect(bar(0)).toHaveText('100 / 100');
  await steps(90);
  // P1 closes in until the bodies touch (documented minimum distance), then 236 + LP.
  await page.keyboard.down('d'); await steps(60); await page.keyboard.up('d'); await steps(2);
  const p2Before = await hp(1);
  await quarterCircle('s', 'd', 'r');
  await expect(page.locator('#state-0')).toContainText('revenge_combo');
  await expect(bar(0)).toHaveText('0 / 100');
  await page.locator('#game').screenshot({ path: `${output}/p1-start.png` });
  expect(await watchCombo(0, 'p1')).toBe(7);
  expect(await hp(1)).toBe(p2Before - 500);
  // 500 damage taken: P2's bar is full now.
  await expect(bar(1)).toHaveText('100 / 100');
  await steps(120);
  await page.keyboard.down('ArrowLeft'); await steps(60); await page.keyboard.up('ArrowLeft'); await steps(2);
  const p1Before = await hp(0);
  await quarterCircle('ArrowDown', 'ArrowLeft', 'Numpad7');
  await expect(page.locator('#state-1')).toContainText('revenge_combo');
  await expect(bar(1)).toHaveText('0 / 100');
  expect(await watchCombo(1, 'p2')).toBe(7);
  expect(await hp(0)).toBe(p1Before - 500);

  // ------------------------------------------ 2. start distances (replays) ----
  const replay = (attacker, distance, crouch) => page.evaluate(async ({ attacker, distance, crouch }) => {
    const { createGame } = await import('/src/simulation/state.ts');
    const { createReplay } = await import('/src/debug/replay.ts');
    const { buttonBit } = await import('/src/input/types.ts');
    const game = createGame(), [a, b] = game.fighters;
    a.x = 400 * 256; b.x = a.x + distance * 256;
    game.fighters[attacker].resources.revenge.current = 100;
    const replay = createReplay(game), n = { up: false, down: false, left: false, right: false, buttons: 0 };
    // P1 faces right (forward = right), P2 faces left (forward = left): 2, 3, 6 + LP.
    // LP comes with forward, so no walk frame changes the measured start distance.
    const forward = { right: attacker === 0, left: attacker === 1 }, defend = { ...n, down: crouch };
    const motion = [{ ...n, down: true }, { ...n, down: true, ...forward }, { ...n, ...forward, buttons: buttonBit('LP') }];
    for (let i = 0; i < 230; i++) {
      const own = motion[i - 4] ?? n;
      replay.frames.push({ inputs: attacker === 0 ? [own, defend] : [defend, own], events: [] });
    }
    return replay;
  }, { attacker, distance, crouch });
  for (const attacker of [0, 1]) for (const stance of ['standing', 'crouching']) {
    const [min, max] = RANGE[stance];
    for (const [distance, want] of [[min, 500], [max, 500], [max + 3, 0]]) {
      await page.locator('#replay-file').setInputFiles({ name: 'revenge.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(await replay(attacker, distance, stance === 'crouching'))) });
      await page.locator('#play').click(); await ensurePaused();
      await steps(12);
      await page.locator('#game').screenshot({ path: `${output}/range-p${attacker + 1}-${stance}-${distance}-opener.png` });
      await steps(220);
      // Beyond the maximum the jab whiffs (the step-in may still bring later strikes into reach).
      const damage = 1000 - await hp(1 - attacker);
      if (want) expect(damage, `P${attacker + 1} ${stance} ${distance} px`).toBe(want);
      else expect(damage, `P${attacker + 1} ${stance} ${distance} px: jab whiffs`).toBeLessThanOrEqual(500 - 40);
      if (want) await page.locator('#game').screenshot({ path: `${output}/range-p${attacker + 1}-${stance}-${distance}-end.png` });
      await page.locator('#play').click();
    }
  }

  // ------------------------------------------------------------ 3. survival ----
  // Deterministic, in the page with the shipped modules.
  const survivalHits = await page.evaluate(async () => {
    const { createSurvival, spawnEnemy, stepSurvival } = await import('/src/survival/state.ts');
    const { SURVIVAL } = await import('/src/survival/config.ts');
    const { bossSpec } = await import('/src/survival/spawner.ts');
    const { buttonBit } = await import('/src/input/types.ts');
    const n = { up: false, down: false, left: false, right: false, buttons: 0 }, result = [];
    for (const kind of ['heavy', bossSpec(SURVIVAL, 1)]) for (const distance of [38, 93]) {
      const s = createSurvival(5); s.spawnTimer = 1e9; s.flow.bossTimer = 1e9; s.flow.waveTimer = 1e9;
      const e = spawnEnemy(s, 1, kind); e.entering = false; e.fighter.x = s.player.x + distance * 256; e.fighter.facing = -1;
      s.player.resources.revenge.current = 100;
      for (const input of [{ down: true }, { down: true, right: true }, { right: true, buttons: buttonBit('LP') }]) stepSurvival(s, { ...n, ...input });
      let hits = 0, hpBefore = e.fighter.hp;
      for (let i = 0; i < 220; i++) { stepSurvival(s, n); if (e.fighter.hp < hpBefore) { hits++; hpBefore = e.fighter.hp; } }
      result.push(hits);
    }
    return result;
  });
  expect(survivalHits).toEqual([7, 7, 7, 7]);
  // The real run: idle until the enemies have filled the bar, then the next enemy in front.
  const read = async () => {
    const [facing, , , over, , , , , front, hits] = (await page.locator('#game').getAttribute('data-survival')).split('|').map(Number);
    return { facing, over, front, hits };
  };
  await page.keyboard.press('F10');
  await expect(page.locator('#match-status')).toContainText('SURVIVAL');
  await ensurePaused();
  await steps(1);
  await expect(page.locator('#game')).toHaveAttribute('data-survival', /\|/);
  for (let i = 0; i < 120 && await bar(0).textContent() !== '100 / 100' && !(await read()).over; i++) await steps(50);
  await expect(bar(0)).toHaveText('100 / 100');
  let started = false;
  for (let i = 0; i < 3000 && !started; i++) {
    const s = await read(), state = await page.locator('#state-0').textContent();
    if (s.over) throw Error('Survival-Lauf vor dem Revenge-Test beendet.');
    const free = /P1 {2}(Idle|Walk) /.test(state);
    if (free && s.front >= RANGE.standing[0] && s.front <= 80) {
      await quarterCircle('s', s.facing === 1 ? 'd' : 'a', 'r');
      started = (await page.locator('#state-0').textContent()).includes('revenge_combo');
      if (!started) await page.locator('#step').click();
    } else await page.locator('#step').click();
  }
  if (!started) throw Error('Revenge-Kombo im Survival nicht gestartet.');
  await expect(bar(0)).toHaveText(/^\d+ \/ 100$/);
  expect(Number((await bar(0).textContent()).split(' / ')[0])).toBeLessThan(100);
  await page.locator('#game').screenshot({ path: `${output}/survival-start.png` });
  let shown = 0;
  for (let i = 0; i < 220; i++) {
    await page.locator('#step').click();
    const { hits } = await read();
    if (hits > shown) { shown = hits; await page.locator('#game').screenshot({ path: `${output}/survival-hit-${hits}.png` }); }
  }
  // Other enemies may interrupt the player in a real run; the opener must land.
  expect(shown).toBeGreaterThanOrEqual(1);
  console.log(`Survival (echter Lauf): ${shown} Treffer`);
  await page.keyboard.press('F10');

  // ---------------------------------------------------- 4. combo list, preview ----
  await expect(page.locator('#combo-list li[data-combo="revenge_combo"]')).toHaveCount(1);
  await expect(page.locator('#combo-list li[data-combo="revenge_combo"] .hint')).toContainText(/Revenge/);
  // The two variants (236 + LK and 236 + RLK) are listed with their own hint and key bindings.
  for (const [id, key] of [['revenge_combo_f', 'LK'], ['revenge_combo_v', 'RLK']]) {
    await expect(page.locator(`#combo-list li[data-combo="${id}"]`)).toHaveCount(1);
    await expect(page.locator(`#combo-list li[data-combo="${id}"] .hint`)).toContainText(/Revenge/);
    await expect(page.locator(`#combo-list li[data-combo="${id}"] .combo-command`)).toContainText(key);
  }
  await page.locator('#animation-preview summary').click();
  for (const [id, variantFrames] of [['revenge_combo_f', [0, 3, 6, 10, 16, 22, 34, 46, 58, 70, 82, 86, 92, 104]], ['revenge_combo_v', [0, 4, 8, 16, 25, 34, 47, 56, 61, 66, 69, 77, 81]]]) {
    await page.locator('#preview-animation').selectOption(id);
    for (const frame of variantFrames) {
      await page.locator('#preview-time').fill(String(frame));
      await expect(page.locator('#preview-canvas')).toHaveAttribute('data-frame', frame.toFixed(2));
      await page.locator('#animation-preview').screenshot({ path: `${output}/preview-${id}-${String(frame).padStart(3, '0')}.png` });
    }
  }
  await page.locator('#preview-animation').selectOption('revenge_combo');
  // Frames with a pose change: key poses, every strike and every support-leg switch.
  const frames = [0, 3, 6, 10, 14, 16, 19, 21, 23, 28, 29, 32, 37, 39, 41, 42, 44, 49, 50, 53, 58, 60, 61, 64, 69, 72, 76];
  for (const facing of [1, -1]) {
    if (facing === -1) await page.locator('#preview-mirror').click();
    for (const frame of frames) {
      await page.locator('#preview-time').fill(String(frame));
      await expect(page.locator('#preview-canvas')).toHaveAttribute('data-frame', frame.toFixed(2));
      await page.locator('#animation-preview').screenshot({ path: `${output}/preview-${facing}-${String(frame).padStart(2, '0')}.png` });
    }
  }
  if (errors.length) throw Error(`Seitenfehler: ${errors.join(' | ')}`);
  console.log(`Revenge Combo Smoke ok — Startabstand ${RANGE.standing.join('–')} px (stehend), ${RANGE.crouching.join('–')} px (hockend); Bilder in ${output}`);
} finally { await browser.close(); }
