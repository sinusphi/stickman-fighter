import {chromium, expect} from '@playwright/test';
import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({
 executablePath:process.env.CHROME_PATH||(existsSync('/usr/bin/google-chrome-stable')?'/usr/bin/google-chrome-stable':undefined),
 headless:true,args:['--no-sandbox'],
});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:5180');
 await page.locator('#game[data-ready="true"]').waitFor();
 await page.locator('#animation-preview summary').click();
 const select=page.locator('#preview-animation'),canvas=page.locator('#preview-canvas'),range=page.locator('#preview-time');
 const catalog=await page.evaluate(async()=>{
  const {animations}=await import('/src/render/skeleton.ts');
  return Object.entries(animations).map(([id,clip])=>({id,last:clip.durationFrames-1}));
 });
 const options=await select.locator('option').evaluateAll(options=>options.map(option=>option.value));
 expect([...options].sort()).toEqual(catalog.map(clip=>clip.id).sort());
 expect(new Set(options).size).toBe(options.length);
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
 await mkdir('test-results/animation-preview',{recursive:true});
 await page.locator('#animation-preview').screenshot({path:'test-results/animation-preview/preview.png'});
 expect(errors).toEqual([]);
 console.log(`Preview: all ${catalog.length} animations, timeline bounds, scrub, mirror, native selection, play/pause, language switch, reopening and zero per-frame option mutations passed.`);
} finally {await browser.close();}
