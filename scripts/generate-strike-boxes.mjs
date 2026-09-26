import { createServer } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
const server=await createServer({server:{middlewareMode:true,ws:false,hmr:false,watch:null},appType:'custom'});
try {
 const {samplePose}=await server.ssrLoadModule('/src/render/skeleton.ts');
 const path=new URL('../src/data/moves.json',import.meta.url),moves=JSON.parse(await readFile(path,'utf8'));
 const bodies=JSON.parse(await readFile(new URL('../src/data/bodies.json',import.meta.url),'utf8'));
 for(const move of moves.filter(m=>m.command.type==='normal' && ['MP','MK','LMK'].includes(m.button))) {
  const ranges=[];
  for(let frame=0;frame<move.startup+move.active+move.recovery;frame++) {
   const old=move.frameRanges.find(r=>r.from<=frame&&r.to>=frame);
   const range={...structuredClone(old),from:frame,to:frame};
   if(frame>=move.startup&&frame<move.startup+move.active) {
    const pose=samplePose(move.id,frame),side=move.button==='MK'?'right':'left';
    const joints=move.button==='MP'?[side+'Elbow',side+'Hand']:[side+'Knee',side+'Foot'];
    const points=joints.map(j=>pose[j]),margin=5;
    const x=Math.floor((Math.min(...points.map(p=>p[0]))-margin)*256),y=Math.floor((Math.min(...points.map(p=>p[1]))-margin)*256);
    const box={x,y,width:Math.ceil((Math.max(...points.map(p=>p[0]))+margin)*256)-x,height:Math.ceil((Math.max(...points.map(p=>p[1]))+margin)*256)-y};
    range.hitboxes=[{...box,hitGroup:move.hitGroups[0].id}];
    range.hurtboxes=[...bodies[move.stance].hurtboxes,box];
   }
   const previous=ranges.at(-1);
   const boxes=r=>JSON.stringify({hitboxes:r.hitboxes,hurtboxes:r.hurtboxes,pushbox:r.pushbox});
   if(previous && boxes(previous)===boxes(range))previous.to=frame;
   else ranges.push(range);
  }
  if(process.argv.includes('--check')) {
   if(JSON.stringify(ranges)!==JSON.stringify(move.frameRanges))throw Error(`${move.id}: strike boxes are stale`);
  }else move.frameRanges=ranges;
 }
 if(!process.argv.includes('--check'))await writeFile(path,JSON.stringify(moves,null,2)+'\n');
 console.log('Punch and middle kick boxes match their striking limbs.');
}finally {await server.close();}
