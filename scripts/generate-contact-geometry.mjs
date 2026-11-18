import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
const server=await createServer({server:{middlewareMode:true,ws:false,hmr:false,watch:null},appType:'custom'});
try {
 const {samplePose,animations}=await server.ssrLoadModule('/src/render/skeleton.ts');
 const {bodyCapsules,strikeCapsule,kneeCapsule}=await server.ssrLoadModule('/src/data/contact-shapes.ts');
 const {isPoseContactMove,strikeJoint}=await server.ssrLoadModule('/src/data/pose-contact-moves.ts');
 const moves=JSON.parse(await readFile(new URL('../src/data/moves.json',import.meta.url),'utf8'));
 const result={};
 for(const [id,animation] of Object.entries(animations)) {
  const move=moves.find(m=>m.id===id);
  result[id]={loop:animation.loop,frames:Array.from({length:animation.durationFrames},(_,f)=>{
   const pose=samplePose(id,f),strikes={};
   if(move && isPoseContactMove(move)) {
    const range=move.frameRanges.find(r=>r.from<=f&&r.to>=f);
    for(const box of range.hitboxes) {
     if(box.hitGroup==='knee') {strikes.knee=kneeCapsule(pose,animation.trail.joint.startsWith('right')?'right':'left');continue;}
     strikes[box.hitGroup]=strikeCapsule(pose,strikeJoint(id,box.hitGroup,(animation.trail??animation.trails?.[0])?.joint));
    }
   }
   return {body:bodyCapsules(pose),strikes};
  })};
 }
 const parts=[{},{},{}];
 Object.entries(result).forEach(([id,geometry],index)=>{parts[index%parts.length][id]=geometry;});
 const outputs=parts.map((part,index)=>[`contact-geometry-${index}.json`,part]);
 for(const [name,data] of outputs) {
  const path=new URL(`../src/data/${name}`,import.meta.url),text=JSON.stringify(data)+'\n';
  if(process.argv.includes('--check')) {if(await readFile(path,'utf8')!==text)throw Error(`Contact geometry stale (${name}): npm run generate:contacts`);}
  else await writeFile(path,text);
 }
 console.log('Baked silhouette contacts synchronized for all animation frames.');
} finally {await server.close();}
