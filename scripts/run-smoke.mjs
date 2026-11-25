// Run: double tap forward and hold. Keyboard, gamepad D-pad and stick in versus,
// keyboard in survival; a tap-tap-release stays idle; the Run clip is listed in
// the animation preview. Phase sheet and screenshots in test-results/run.
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { TEST_URL, chromeExecutable } from './smoke-env.mjs';
const output = 'test-results/run'; await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: chromeExecutable(), headless: true, args: ['--no-sandbox'] });
const state = page => page.locator('#state-0');
/** Two quick presses; the second one stays held unless `release`. */
async function doubleTap(page, press, release, hold = true) {
  await press(); await page.waitForTimeout(60); await release(); await page.waitForTimeout(60); await press();
  if (!hold) { await page.waitForTimeout(16); await release(); }
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    window.testPad = { id: 'Simulated pad', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0], buttons: Array.from({ length: 20 }, () => ({ value: 0, pressed: false, touched: false })) };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [window.testPad] });
  });
  await page.goto(TEST_URL); await page.locator('#game[data-ready="true"]').waitFor();
  await page.keyboard.press('F3');

  // Keyboard: tap, tap and hold runs; releasing stops at once.
  const keyDown = () => page.keyboard.down('d'), keyUp = () => page.keyboard.up('d');
  await doubleTap(page, keyDown, keyUp);
  await expect(state(page)).toContainText('Run');
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${output}/versus-run.png` });
  await keyUp();
  await expect(state(page)).toContainText('Idle');
  await page.locator('#reset').click();
  // Tap, tap, release: no run, the fighter stays idle.
  await doubleTap(page, keyDown, keyUp, false);
  await page.waitForTimeout(300);
  await expect(state(page)).toContainText('Idle');
  // A single held press walks.
  await keyDown(); await page.waitForTimeout(400);
  await expect(state(page)).toContainText('Walk');
  await keyUp(); await page.locator('#reset').click();

  // Gamepad: D-pad right (button 15) and the stick behave like the keyboard.
  await page.locator('#settings-details summary').click();
  await page.locator('[data-device="0"] option[value="0"]').waitFor({ state: 'attached' });
  await page.locator('[data-device="0"]').selectOption('0');
  await page.locator('#settings-details summary').click();
  if (await page.locator('#step').isEnabled()) await page.locator('#pause').click();
  const pad = (fn) => page.evaluate(fn);
  const dpadDown = () => pad(() => { window.testPad.buttons[15] = { value: 1, pressed: true, touched: true }; });
  const dpadUp = () => pad(() => { window.testPad.buttons[15] = { value: 0, pressed: false, touched: false }; });
  await doubleTap(page, dpadDown, dpadUp);
  await expect(state(page)).toContainText('Run');
  await dpadUp();
  await expect(state(page)).toContainText('Idle');
  await page.locator('#reset').click();
  const stickRight = () => pad(() => { window.testPad.axes[0] = 0.9; }), stickCenter = () => pad(() => { window.testPad.axes[0] = 0; });
  await doubleTap(page, stickRight, stickCenter);
  await expect(state(page)).toContainText('Run');
  // Back (block direction) ends the run.
  await pad(() => { window.testPad.axes[0] = -0.9; });
  await expect(state(page)).toContainText('Walk');
  await stickCenter();
  await expect(state(page)).toContainText('Idle');

  // Survival: same double tap along the fixed facing.
  await page.keyboard.press('F10');
  await expect(page.locator('#match-status')).toContainText('SURVIVAL');
  await doubleTap(page, keyDown, keyUp);
  await expect(state(page)).toContainText('Run');
  await page.screenshot({ path: `${output}/survival-run.png` });
  await keyUp();
  await expect(state(page)).not.toContainText('Run');
  await page.keyboard.press('F10');
  await expect(page.locator('#survival')).toHaveAttribute('aria-pressed', 'false');

  // Animation preview lists the generated Run cycle.
  if (await page.locator('#step').isEnabled() === false) await page.locator('#pause').click();
  await page.locator('#animation-preview summary').click();
  await page.locator('#preview-animation').selectOption('Run');
  await expect(page.locator('#preview-animation option[value="Run"]')).toHaveText(/Run|Rennen/);
  await page.locator('#preview-canvas').screenshot({ path: `${output}/preview.png` });
  await page.locator('#animation-preview summary').click();

  // Phase sheet: Run next to Walk for a visual check.
  await page.evaluate(async () => {
    const { samplePose, animations } = await import('/src/render/skeleton.ts'); const { sampleDepths } = await import('/src/render/depth.ts');
    const { drawFigure } = await import('/src/render/figure.ts'); const { readPalette } = await import('/src/platform/theme.ts');
    const palette = readPalette(), c = document.createElement('canvas'); c.id = 'run-phases'; c.width = 1500; c.height = 450; c.style.cssText = 'width:1500px;height:450px;max-width:none;aspect-ratio:auto'; document.body.append(c);
    const ctx = c.getContext('2d'); ctx.fillStyle = palette.arena; ctx.fillRect(0, 0, c.width, c.height);
    ['Run', 'Walk'].forEach((id, row) => {
      for (let col = 0; col < 6; col++) {
        const time = (animations[id].durationFrames - 1) * col / 6;
        ctx.save(); ctx.translate(250 * col + 110, 200 * row + 180); ctx.scale(1.6, 1.6);
        ctx.strokeStyle = palette.ground; ctx.beginPath(); ctx.moveTo(-60, 0); ctx.lineTo(70, 0); ctx.stroke();
        drawFigure(ctx, samplePose(id, time), palette.p1, palette, 1, 0, sampleDepths(id, time)); ctx.restore();
        ctx.fillStyle = palette.text; ctx.font = '13px monospace'; ctx.fillText(`${id} / ${time.toFixed(1)}`, 250 * col + 8, 200 * row + 18);
      }
    });
  });
  await page.locator('#run-phases').screenshot({ path: `${output}/phases.png` });
  expect(errors).toEqual([]);
  await page.close();
  console.log('Run via keyboard, D-pad and stick (versus) and keyboard (survival) verified; Run clip in the preview.');
} finally { await browser.close(); }
