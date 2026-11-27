import {chromium, expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import { TEST_URL, chromeExecutable } from './smoke-env.mjs';
const browser=await chromium.launch({
 executablePath:chromeExecutable(),
 headless:true,args:['--no-sandbox'],
});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(TEST_URL);
 await page.locator('#game[data-ready="true"]').waitFor();
 const combos=page.locator('#combo-list');
 await expect(combos).not.toHaveAttribute('open','');
 expect(await page.locator('.training-bar').evaluate(bar=>bar.previousElementSibling.className)).toBe('toolbar');
 expect(await combos.evaluate(panel=>panel.previousElementSibling.className)).toBe('training-bar');
 await expect(page.locator('[data-i18n="controls.hint"]')).toHaveCount(0);
 await combos.locator('summary').click();
 const comboCommands=await page.evaluate(async()=>{
  const {default:moves}=await import('/src/data/moves.json');
  return moves.filter(move=>move.command.buttons.length>1||move.command.type==='motion').map(move=>({id:move.id,buttons:move.command.buttons,direction:move.command.directions[0],motion:move.command.type==='motion'}));
 });
 // Throws are listed in their own section below the combos.
 await expect(combos.locator('.combo-list:not(.throw-list) li')).toHaveCount(comboCommands.length);
 for(const [id,label] of [['throw_forward','Forward (6)'],['throw_back','Back (4)']]) {
  const row=combos.locator(`.throw-list [data-combo="${id}"]`);
  await expect(row.locator('.combo-command')).toHaveText(`${label} + THROW`);
  for(const player of [0,1])await expect(row.locator(`[data-owner="${player}"][data-control="THROW"]`)).toHaveText(await page.locator(`.controls [data-owner="${player}"][data-control="THROW"]`).innerText());
 }
 await expect(combos.locator('.throw-list li')).toHaveCount(2);
 for(const {id,buttons,direction,motion} of comboCommands) {
  const row=combos.locator(`[data-combo="${id}"]`);
  // Motion moves (revenge_combo: 23 + LP) show the down, down-forward input instead of a hold direction.
  await expect(row.locator('.combo-command')).toHaveText(`${motion?'Hold down, add forward (↓ ↘, 23)':direction===6?'Forward (6)':'Back (4)'} + ${buttons.join(' + ')}`);
  if(motion)for(const player of [0,1])for(const control of ['down',player===0?'right':'left'])await expect(row.locator(`[data-owner="${player}"][data-control="${control}"]`).first()).toHaveText(await page.locator(`.controls [data-owner="${player}"][data-control="${control}"]`).innerText());
  for(const player of [0,1])for(const button of buttons) {
   await expect(row.locator(`[data-owner="${player}"][data-control="${button}"]`)).toHaveText(await page.locator(`.controls [data-owner="${player}"][data-control="${button}"]`).innerText());
  }
 }
 await mkdir('test-results/animation-preview',{recursive:true});
 await combos.screenshot({path:'test-results/animation-preview/combos-en.png'});
 await combos.locator('summary').click();
 await page.locator('#animation-preview summary').click();
 const select=page.locator('#preview-animation'),canvas=page.locator('#preview-canvas'),range=page.locator('#preview-time');
 const catalog=await page.evaluate(async()=>{
  const {animations}=await import('/src/render/skeleton.ts');
  return Object.entries(animations).map(([id,clip])=>({id,last:clip.durationFrames-1}));
 });
 const options=await select.locator('option').evaluateAll(options=>options.map(option=>option.value));
 expect([...options].sort()).toEqual(catalog.map(clip=>clip.id).sort());
 expect(new Set(options).size).toBe(options.length);
 await expect(select.locator('option[value="revenge_combo"]')).toContainText('23+LP');
 await expect(select.locator('option[value="revenge_combo_f"]')).toContainText('23+LK');
 await expect(select.locator('option[value="revenge_combo_v"]')).toContainText('23+RLK');
 await expect(select).toHaveValue('Idle');
 expect(await select.locator('optgroup').evaluateAll(groups=>groups.map(group=>group.label))).toEqual([
  'Movement & guard','Standing','Crouching','Airborne','Special attacks','Combos','Throws','Blocks & hit reactions','Rotation demos',
 ]);
 for(const stance of ['standing','crouching','airborne']) {
  expect(options.filter(id=>id.startsWith(`${stance}_`))).toEqual(['lp','mp','hp','lk','lmk','hk','rlk','mk','rhk'].map(button=>`${stance}_${button}`));
 }
 const gameFrame=await page.locator('#game').getAttribute('data-frame');
 // Observe the real DOM: any option rewrite from the frame loop regresses
 // native dropdown stability, even if select.value itself stays unchanged.
 await select.evaluate(select=>{
  window.previewOptionMutations=0;
  new MutationObserver(records=>window.previewOptionMutations+=records.length)
   .observe(select,{subtree:true,childList:true,characterData:true,attributes:true});
 });
 for(const {id,last} of catalog) {
  await select.selectOption(id);
  await expect(range).toHaveAttribute('max',String(last));
  await expect(canvas).toHaveAttribute('data-animation',id);
  for(const frame of [0,last/2,last]) {
   await range.fill(String(frame));
   await expect(canvas).toHaveAttribute('data-frame',frame.toFixed(2));
  }
  await page.locator('#preview-mirror').click();
  await expect(select).toHaveValue(id);
 }
 // Exercise the native popup and keyboard selection while rAF keeps running.
 await select.selectOption('DemoBodyCW');
 await select.click();
 await page.waitForTimeout(350);
 await page.keyboard.press('Escape');
 await select.focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
 await expect(select).toHaveValue('DemoBodyCCW');
 await page.locator('#preview-play').click();
 await expect.poll(async()=>Number(await canvas.getAttribute('data-frame'))).toBeGreaterThan(2);
 await page.locator('#preview-play').click();
 const stopped=await canvas.getAttribute('data-frame');
 await page.waitForTimeout(150);
 expect(await canvas.getAttribute('data-frame')).toBe(stopped);
 expect(await page.evaluate(()=>window.previewOptionMutations)).toBe(0);
 await page.locator('#language').click();
 await expect(select).toHaveValue('DemoBodyCCW');
 await expect(select.locator('option[value="standing_lp"]')).toContainText('Punch leicht');
 await expect(select.locator('option[value="Idle"]')).toHaveText('Stand / Deckung');
 await expect(select.locator('optgroup').first()).toHaveAttribute('label','Bewegung & Deckung');
 await combos.locator('summary').click();
 await expect(combos.locator('summary')).toHaveText('Kombos');
 await expect(combos.locator('[data-combo="double_high_kick"] strong')).toHaveText('Doppel-Highkick');
 await expect(combos.locator('[data-combo="middle_high_low_combo"] .combo-command')).toHaveText('Vorwärts (6) + LMK + MK');
 await page.evaluate(()=>{window.previewOptionMutations=0;});
 await page.waitForTimeout(150);
 expect(await page.evaluate(()=>window.previewOptionMutations)).toBe(0);
 for(let i=0;i<3;i++) {
  await page.locator('#animation-preview summary').click();
  await page.locator('#animation-preview summary').click();
  await select.selectOption('standing_hp');
  await expect(canvas).toHaveAttribute('data-animation','standing_hp');
 }
 expect(await page.locator('#game').getAttribute('data-frame')).toBe(gameFrame);
 // Rebinding commits a simulation configuration event, so check pause stability
 // above before changing settings. The combo labels must follow the new binding.
 await page.locator('#settings-details summary').click();
 await page.locator('[data-player="0"][data-action="LMK"]').click();await page.keyboard.press('j');
 await expect(combos.locator('[data-owner="0"][data-control="LMK"]').first()).toHaveText('J');
 await page.locator('#settings-details summary').click();
 await mkdir('test-results/animation-preview',{recursive:true});
 await page.locator('#animation-preview').screenshot({path:'test-results/animation-preview/preview.png'});
 await page.setViewportSize({width:390,height:844});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await combos.screenshot({path:'test-results/animation-preview/combos-de-mobile.png'});
 await page.screenshot({path:'test-results/animation-preview/menu-de-mobile.png',fullPage:true});
 expect(errors).toEqual([]);
 console.log(`Preview: all ${catalog.length} animations, ordered groups, timeline bounds, scrub, mirror, native selection, play/pause, language switch, reopening and zero per-frame option mutations passed. All ${comboCommands.length} combos, commands, live keyboard bindings, placement and mobile layout passed.`);
} finally {await browser.close();}
