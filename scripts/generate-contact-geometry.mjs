import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
const server=await createServer({server:{middlewareMode:true,ws:false,hmr:false,watch:null},appType:'custom'});
try {
 const {samplePose,animations}=await server.ssrLoadModule('/src/render/skeleton.ts');
 const {bodyCapsules,strikeCapsule,kneeCapsule}=await server.ssrLoadModule('/src/data/contact-shapes.ts');
 const moves=JSON.parse(await readFile(new URL('../src/data/moves.json',import.meta.url),'utf8'));
 const result={};
 for(const [id,animation] of Object.entries(animations)) {
  const move=moves.find(m=>m.id===id);
  result[id]={loop:animation.loop,frames:Array.from({length:animation.durationFrames},(_,f)=>{
   const pose=samplePose(id,f),strikes={};
   if(move && ((move.command.type==='normal' && ['HP','MK','LMK','HK','RHK'].includes(move.button)) || ['spin_mk','spin_hk','tornado_mk','forward_spin_hk','tornado_spin_combo'].includes(id))) {
    const range=move.frameRanges.find(r=>r.from<=f&&r.to>=f);
    for(const box of range.hitboxes) {
     if(box.hitGroup==='knee') {strikes.knee=kneeCapsule(pose,animation.trail.joint.startsWith('right')?'right':'left');continue;}
     const joint=id==='tornado_spin_combo'?(box.hitGroup==='spin'?'leftFoot':'rightFoot'):
      (animation.trail??animation.trails?.[0]).joint;
     strikes[box.hitGroup]=strikeCapsule(pose,joint);
    }
   }
   return {body:bodyCapsules(pose),strikes};
  })};
 }
 const path=new URL('../src/data/contact-geometry.json',import.meta.url),text=JSON.stringify(result)+'\n';
 if(process.argv.includes('--check')) {if(await readFile(path,'utf8')!==text)throw Error('Contact geometry stale: npm run generate:contacts');}
 else await writeFile(path,text);
 console.log('Baked silhouette contacts synchronized for all animation frames.');
} finally {await server.close();}
