import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
const output='test-results/contact-timing';await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||(existsSync('/usr/bin/google-chrome-stable')?'/usr/bin/google-chrome-stable':undefined),headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage({viewport:{width:1600,height:1200}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.TEST_URL||'http://127.0.0.1:5180');await page.locator('#game[data-ready="true"]').waitFor();
 await page.locator('#pause').click();
 const summary=await page.evaluate(async()=>{
  const {createGame,step,snapshot}=await import('/src/simulation/state.ts');
  const {MOVES}=await import('/src/data/schema.ts');
  const {render}=await import('/src/render/canvas.ts');
  const {readPalette}=await import('/src/platform/theme.ts');
  const {HitFeedback}=await import('/src/render/feedback.ts');
  const palette=readPalette(),canvas=document.createElement('canvas');canvas.width=960;canvas.height=420;
  const sheet=document.createElement('canvas');sheet.id='contact-sheet';sheet.width=1500;sheet.height=1260;document.body.append(sheet);
  sheet.style.cssText='width:1500px;max-width:none;aspect-ratio:auto';const ctx=sheet.getContext('2d');
  const ids=['standing_hp','standing_mk','standing_hk'],result=[];
  let row=0;
  for(const facing of [1,-1])for(const id of ids) {
   const game=createGame(),[a,b]=game.fighters;a.x=480*256;b.x=a.x+facing*50*256;
   a.facing=a.attackFacing=facing;b.facing=b.attackFacing=-facing;a.state='Attack';a.moveId=id;a.moveFrame=MOVES[id].startup-1;
   const feedback=new HitFeedback();let previous=snapshot(game);
   const advance=()=>{previous=snapshot(game);step(game);feedback.update(game,previous);};
   const draw=()=>render(canvas,game,previous,1,true,false,palette,feedback.levels,feedback.koFrames);
   const stamp=(col,label)=>{draw();ctx.drawImage(canvas,355,165,250,175,col*300,row*210+25,300,180);ctx.fillStyle=palette.text;ctx.font='13px monospace';ctx.fillText(`${id} / ${facing} / ${label}`,col*300+5,row*210+17);};
   ctx.fillStyle=palette.arena;ctx.fillRect(0,row*210,1500,210);
   advance();if(!game.lastContact)throw Error(`${id}: no close contact`);
   stamp(0,'Kontakt');const first=canvas.toDataURL();
   while(game.hitstop>1)advance();stamp(1,'Ende Trefferpause');
   if(canvas.toDataURL()!==first)throw Error(`${id}: impact image drifted during hitstop`);
   for(let i=0;i<7;i++)advance();stamp(2,'Rückführung');
   while(a.state==='Attack')advance();stamp(3,'Deckung');
   result.push({id,facing,damage:1000-b.hp,duration:MOVES[id].duration});
   const far=createGame();far.fighters[0].x=480*256;far.fighters[1].x=far.fighters[0].x+facing*100*256;
   far.fighters[0].facing=far.fighters[0].attackFacing=facing;far.fighters[1].facing=-facing;
   far.fighters[0].state='Attack';far.fighters[0].moveId=id;far.fighters[0].moveFrame=MOVES[id].startup-1;
   const old=snapshot(far);step(far);if(far.lastContact)throw Error(`${id}: distant phantom hit`);
   render(canvas,far,old,1,true,false,palette);ctx.drawImage(canvas,325,165,310,175,1200,row*210+25,300,180);ctx.fillStyle=palette.text;ctx.fillText('100 Abstand: kein Treffer',1205,row*210+17);
   row++;
  }
  return result;
 });
 await page.locator('#contact-sheet').screenshot({path:`${output}/contacts.png`});
 expect(errors).toEqual([]);await writeFile(`${output}/summary.json`,JSON.stringify(summary,null,2)+'\n');
 console.log('Both facings: hook/middle/high hit visibly, freeze the exact contact image, recover and whiff at distance; screenshots saved.');
}finally{await browser.close();}
