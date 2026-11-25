// Survival layout: the HUD texts (labels, energy values, the big timer, the
// best time) and the canvas boss bar must never overlap or be clipped, also
// with three-digit minutes, long German labels and narrow windows. Checks the
// rendered text boxes (DOM ranges, not element boxes, so overflowing text is
// caught) at several window widths with a miniboss on screen. Also checks the
// edge arrow contract (data-edge) and keeps a screenshot when one shows.
// Screenshots in test-results/survival-layout.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { TEST_URL, chromeExecutable } from './smoke-env.mjs';

const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true, args: ['--no-sandbox'] });
const output = 'test-results/survival-layout'; await mkdir(output, { recursive: true });
const WIDTHS = [1440, 1100, 860, 760, 700, 560, 420, 360];
/** Worst cases: long run times, German labels, a big enemy energy value. */
const SAMPLES = [
  { timer: '11:02', round: 'BESTZEIT 11:02', hp0: '1000 / 1000', hp1: '181 / 520', p2: 'GEGNER 7' },
  { timer: '100:00', round: 'BESTZEIT 100:00', hp0: '1150 / 1000', hp1: '1520 / 1520', p2: 'GEGNER 12' },
];
const TEXTS = ['p1-label', 'hp-0', 'timer', 'round-label', 'hp-1', 'p2-label'];

const failures = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(TEST_URL);
  await page.locator('#game[data-ready="true"]').waitFor();
  await page.keyboard.press('F10');
  await page.locator('#pause').click();
  const step = n => page.locator('#step').evaluate((b, count) => { for (let i = 0; i < count; i++) b.click(); }, n);
  const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const read = async () => (await page.locator('#game').getAttribute('data-survival'))?.split('|').map(Number);

  // Step to the first miniboss; meanwhile watch the edge arrows (they need a stalled walk-in, so they are optional here).
  let edgeSeen = false, bossFrames = 0;
  for (; bossFrames < 3200 && !(await read())[5]; bossFrames += 4) {
    await step(4); await frames();
    const edge = await page.locator('#game').getAttribute('data-edge');
    if (!/^\d+\|\d+\|\d+$/.test(edge ?? '')) throw Error(`data-edge fehlt oder ist kaputt: ${edge}`);
    if (!edgeSeen && edge !== '0|0|0') { edgeSeen = true; await page.locator('#game').screenshot({ path: `${output}/edge-arrow.png` }); }
  }
  if (!(await read())[5]) throw Error('Kein Miniboss erschienen.');
  await step(60); await frames();

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const [index, sample] of SAMPLES.entries()) {
      await page.evaluate(s => {
        // The HUD writes only changed values; while paused nothing changes, so the injected texts stay.
        for (const [id, value] of Object.entries({ timer: s.timer, 'round-label': s.round, 'hp-0': s.hp0, 'hp-1': s.hp1, 'p2-label': s.p2 })) document.getElementById(id).textContent = value;
      }, sample);
      await frames();
      const result = await page.evaluate(ids => {
        const rect = r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
        const arena = document.querySelector('.arena').getBoundingClientRect();
        const boxes = [], problems = [];
        for (const id of ids) {
          const el = document.getElementById(id), box = el.getBoundingClientRect();
          if (!box.width || getComputedStyle(el).display === 'none') continue;
          const range = document.createRange(); range.selectNodeContents(el);
          const ink = rect(range.getBoundingClientRect());
          // Clipped (ellipsis) or spilling out of its own box (the timer column).
          const holder = id === 'timer' || id === 'round-label' ? el.closest('.timer-wrap').getBoundingClientRect() : box;
          if (ink.left < holder.left - .5 || ink.right > holder.right + .5) problems.push(`${id} ragt aus seiner Box (${Math.round(ink.left)}..${Math.round(ink.right)} statt ${Math.round(holder.left)}..${Math.round(holder.right)})`);
          if (ink.left < arena.left || ink.right > arena.right) problems.push(`${id} liegt außerhalb der Arena`);
          boxes.push({ id, ...ink });
        }
        const canvas = document.getElementById('game'), c = canvas.getBoundingClientRect(), s = c.width / 960;
        const bar = canvas.dataset.bossBar?.split('|').map(Number);
        if (bar) boxes.push({ id: 'boss-bar', left: c.left + bar[0] * s, top: c.top + bar[1] * s, right: c.left + (bar[0] + bar[2]) * s, bottom: c.top + (bar[1] + bar[3]) * s });
        else problems.push('keine Bossleiste (data-boss-bar)');
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          if (a.left < b.right - .5 && b.left < a.right - .5 && a.top < b.bottom - .5 && b.top < a.bottom - .5) problems.push(`${a.id} überlappt ${b.id}`);
        }
        return { problems, boxes: boxes.map(b => `${b.id}:${Math.round(b.left)}..${Math.round(b.right)}/${Math.round(b.top)}..${Math.round(b.bottom)}`) };
      }, TEXTS);
      await page.locator('.arena').screenshot({ path: `${output}/hud-${width}-${index}.png` });
      for (const problem of result.problems) failures.push(`${width}px, ${sample.timer}: ${problem} [${result.boxes.join(' ')}]`);
    }
  }
  if (errors.length) failures.push(`Seitenfehler: ${errors.join(' | ')}`);
  if (failures.length) throw Error(`Survival-Layout:\n  ${failures.join('\n  ')}`);
  console.log(`Survival Layout Smoke ok (${WIDTHS.length} Breiten, Boss nach ${bossFrames} Frames, Randpfeil ${edgeSeen ? 'gesehen' : 'in diesem Lauf nicht aufgetreten'}) — Bilder in ${output}`);
} finally { await browser.close(); }
