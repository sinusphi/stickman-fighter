import { createServer } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
const server=await createServer({server:{middlewareMode:true,ws:false,hmr:false,watch:null},appType:'custom'});
try {
 const {samplePose}=await server.ssrLoadModule('/src/render/skeleton.ts');
 const {strikeCapsule,kneeCapsule,capsuleBoxes}=await server.ssrLoadModule('/src/data/contact-shapes.ts');
 const path=new URL('../src/data/moves.json',import.meta.url),moves=JSON.parse(await readFile(path,'utf8'));
 const bodies=JSON.parse(await readFile(new URL('../src/data/bodies.json',import.meta.url),'utf8'));
 for(const move of moves.filter(m=>m.command.type==='normal' && ['MP','HP','MK','LMK','HK','RHK'].includes(m.button))) {
  const ranges=[];
  for(let frame=0;frame<move.startup+move.active+move.recovery;frame++) {
   const old=move.frameRanges.find(r=>r.from<=frame&&r.to>=frame);
   const range={...structuredClone(old),from:frame,to:frame,hitboxes:[],hurtboxes:structuredClone(bodies[move.stance].hurtboxes)};
   const main=move.hitGroups.find(g=>!g.activeFrames);
   // Early knee strike of a kick: its own window before the main active phase.
   const knee=move.hitGroups.find(g=>g.id==='knee'&&g.activeFrames&&frame>=g.activeFrames[0]&&frame<=g.activeFrames[1]);
   if(knee) {
    const pose=samplePose(move.id,frame),side=['MK','RHK'].includes(move.button)?'right':'left';
    const capsule=kneeCapsule(pose,side),margin=5;
    const points=[[capsule[0]/256,capsule[1]/256],pose[side+'Knee']];
    const x=Math.floor((Math.min(...points.map(p=>p[0]))-margin)*256),y=Math.floor((Math.min(...points.map(p=>p[1]))-margin)*256);
    const box={x,y,width:Math.ceil((Math.max(...points.map(p=>p[0]))+margin)*256)-x,height:Math.ceil((Math.max(...points.map(p=>p[1]))+margin)*256)-y};
    range.hitboxes=capsuleBoxes(capsule).map(box=>({...box,hitGroup:knee.id}));
    range.hurtboxes=[...bodies[move.stance].hurtboxes,box];
   } else if(frame>=move.startup&&frame<move.startup+move.active) {
    const pose=samplePose(move.id,frame),side=['MK','RHK'].includes(move.button)?'right':'left';
    const joints=['MP','HP'].includes(move.button)?[side+'Elbow',side+'Hand']:[side+'Knee',side+'Foot'];
    const points=joints.map(j=>pose[j]),margin=5;
    const x=Math.floor((Math.min(...points.map(p=>p[0]))-margin)*256),y=Math.floor((Math.min(...points.map(p=>p[1]))-margin)*256);
    const box={x,y,width:Math.ceil((Math.max(...points.map(p=>p[0]))+margin)*256)-x,height:Math.ceil((Math.max(...points.map(p=>p[1]))+margin)*256)-y};
    range.hitboxes=(move.button==='MP'?[box]:capsuleBoxes(strikeCapsule(pose,joints[1]))).map(box=>({...box,hitGroup:main.id}));
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
 console.log('Middle/heavy punch and middle/high kick boxes (including knee windows) match their striking limbs.');
}finally {await server.close();}
