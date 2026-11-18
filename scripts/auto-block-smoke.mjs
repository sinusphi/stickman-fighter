import {chromium,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {TEST_URL,chromeExecutable} from './smoke-env.mjs';

const browser=await chromium.launch({executablePath:chromeExecutable(),headless:true,args:['--no-sandbox']});
const output='test-results/auto-block';await mkdir(output,{recursive:true});
try {
  const page=await browser.newPage({viewport:{width:1280,height:1080}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(TEST_URL);await page.locator('canvas[data-ready="true"]').waitFor();
  if(!await page.locator('#step').isEnabled())await page.locator('#pause').click();
  await page.locator('#auto-block').click();
  await expect(page.locator('#auto-block')).toHaveAttribute('aria-pressed','true');
  const steps=n=>page.locator('#step').evaluate((button,n)=>{for(let i=0;i<n;i++)button.click();},n);
  const cases=[['LP',['r','Numpad7'],104,5,2],['HP',['y','Numpad9'],104,8,7],
    ['HK',['h','Numpad6'],96,17,8],['RHK',['n','Numpad3'],94,17,8]];
  for(const player of [0,1])for(const [name,keys,approach,startup,chip] of cases) {
    await page.locator('#reset').click();
    const forward=player===0?'d':'ArrowLeft';
    await page.keyboard.down(forward);await steps(approach);await page.keyboard.up(forward);
    await page.keyboard.down(keys[player]);await steps(1);await page.keyboard.up(keys[player]);
    await steps(startup);
    const defender=1-player;
    await expect(page.locator(`#hp-${defender}`)).toHaveText(`${1000-chip} / 1000`);
    await expect(page.locator(`#state-${defender}`)).toContainText('Blockstun');
    await page.screenshot({path:`${output}/p${player+1}-${name}.png`,fullPage:true});
  }
  expect(errors).toEqual([]);
  console.log('Auto-block browser smoke passed: neutral standing LP/HP/HK/RHK guard with exact chip damage for both players/facings via actual keyboard input.');
}finally{await browser.close();}
