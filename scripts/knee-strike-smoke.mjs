import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
// Knee before middle/high kicks: rendered knee contact with burst, fading burst,
// following kick contact, and a kick-only distance. Both facings and both themes.
const output='test-results/knee-strike';await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||(existsSync('/usr/bin/google-chrome-stable')?'/usr/bin/google-chrome-stable':undefined),headless:true,args:['--no-sandbox']});
try {
 const summary={};
 for(const theme of ['dark','light']) {
  const page=await browser.newPage({viewport:{width:1600,height:1200},colorScheme:theme}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.TEST_URL||'http://127.0.0.1:5180');await page.locator('#game[data-ready="true"]').waitFor();
  if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('#theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
  await page.locator('#pause').click();
  summary[theme]=await page.evaluate(async()=>{
   const {createGame,step,snapshot}=await import('/src/simulation/state.ts');
   const {MOVES}=await import('/src/data/schema.ts');
   const {render}=await import('/src/render/canvas.ts');
   const {readPalette}=await import('/src/platform/theme.ts');
   const {HitFeedback}=await import('/src/render/feedback.ts');
   const {buttonBit,neutralInput}=await import('/src/input/types.ts');
   const palette=readPalette(),canvas=document.createElement('canvas');canvas.width=960;canvas.height=420;
   const kicks=[['MK','standing_mk'],['RHK','standing_rhk'],['LMK','standing_lmk'],['HK','standing_hk']];
   const sheet=document.createElement('canvas');sheet.id='knee-sheet';sheet.width=1500;sheet.height=kicks.length*2*210;document.body.append(sheet);
   sheet.style.cssText='width:1500px;max-width:none;aspect-ratio:auto';const ctx=sheet.getContext('2d');
   const pixels=()=>canvas.getContext('2d').getImageData(0,0,960,420).data;
   const changed=(a,b)=>{let n=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>30)n++;return n;};
   const result=[];let row=0;
   for(const facing of [1,-1])for(const [button,id] of kicks) {
    const game=createGame(),[a,b]=game.fighters;a.x=(facing===1?400:560)*256;b.x=a.x+facing*45*256;
    const feedback=new HitFeedback();let previous=snapshot(game),frame=0;
    const advance=()=>{previous=snapshot(game);step(game,[{...neutralInput(),buttons:frame++===0?buttonBit(button):0},neutralInput()]);feedback.update(game,previous);};
    const draw=()=>render(canvas,game,previous,1,true,false,palette,feedback.levels,feedback.koFrames);
    const left=(a.x+b.x)/512-145;
    const stamp=(col,label)=>{draw();ctx.drawImage(canvas,left,150,290,200,col*300,row*210+25,300,190);ctx.fillStyle=palette.text;ctx.font='13px monospace';ctx.fillText(`${id} / ${facing} / ${label}`,col*300+5,row*210+17);};
    ctx.fillStyle=palette.arena;ctx.fillRect(0,row*210,1500,210);
    while(!game.lastContact)advance();
    const knee=MOVES[id].hitGroups.find(g=>g.id==='knee');
    if(a.moveFrame<knee.activeFrames[0]||a.moveFrame>knee.activeFrames[1])throw Error(`${id}: first contact is not the knee (${a.moveFrame})`);
    if(1000-b.hp!==knee.damage)throw Error(`${id}: knee damage ${1000-b.hp}`);
    stamp(0,'Knie-Kontakt');const burst=pixels();
    for(let i=0;i<4;i++)advance();stamp(1,'Trefferpause');
    while(game.hitstop)advance();stamp(2,'Pause vorbei');const settled=pixels();
    const fade=changed(burst,settled);if(fade<40)throw Error(`${id}: no visible knee burst (${fade} px)`);
    const kneeHp=b.hp;while(b.hp===kneeHp)advance();stamp(3,'Kick-Kontakt');
    if(kneeHp-b.hp!==MOVES[id].damage||a.moveFrame!==MOVES[id].startup)throw Error(`${id}: kick after knee`);
    const far=createGame();far.fighters[0].x=(facing===1?400:560)*256;far.fighters[1].x=far.fighters[0].x+facing*(MOVES[id].advance?80:70)*256;
    let farFrame=0,firstFar=null;
    while(far.fighters[0].state!=='Attack'||far.fighters[0].moveFrame<MOVES[id].startup+MOVES[id].active){
     const old=snapshot(far);step(far,[{...neutralInput(),buttons:farFrame++===0?buttonBit(button):0},neutralInput()]);
     if(far.lastContact&&!firstFar){firstFar=far.fighters[0].moveFrame;render(canvas,far,old,1,true,false,palette);ctx.drawImage(canvas,(far.fighters[0].x+far.fighters[1].x)/512-145,150,290,200,1200,row*210+25,300,190);}
     if(farFrame>80)break;
    }
    if(firstFar!==MOVES[id].startup)throw Error(`${id}: far contact at ${firstFar}, expected kick only`);
    ctx.fillStyle=palette.text;ctx.fillText('weiter weg: nur Kick',1205,row*210+17);
    result.push({id,facing,knee:knee.damage,kick:MOVES[id].damage,burstPixels:fade});
    row++;
   }
   return result;
  });
  await page.locator('#knee-sheet').screenshot({path:`${output}/${theme}.png`});
  expect(errors).toEqual([]);await page.close();
 }
 await writeFile(`${output}/summary.json`,JSON.stringify(summary,null,2)+'\n');
 console.log('Knee hits up close with a visible burst, the kick follows, farther away only the kick connects; both facings and themes.');
}finally{await browser.close();}
