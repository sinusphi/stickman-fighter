import { createServer } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
const server=await createServer({server:{middlewareMode:true,ws:false,hmr:false,watch:null},appType:'custom'});
try {
  const {samplePose}=await server.ssrLoadModule('/src/render/skeleton.ts');
  const {spinFrameBoxes}=await server.ssrLoadModule('/src/data/spin-boxes.ts');
  const path=new URL('../src/data/moves.json',import.meta.url),moves=JSON.parse(await readFile(path,'utf8'));
  let count=0;
  for(const move of moves.filter(m=>['spin_mk','spin_hk'].includes(m.id))) {
    const frames=Array.from({length:move.startup+move.active+move.recovery},(_,frame)=>({
      from:frame,to:frame,...spinFrameBoxes(samplePose(move.animation,frame),frame>=move.startup && frame<move.startup+move.active),
    }));
    if(process.argv.includes('--check')) {
      if(JSON.stringify(frames)!==JSON.stringify(move.frameRanges))throw Error(`${move.id}: Boxdaten veraltet. npm run generate:spin-boxes ausführen.`);
    } else move.frameRanges=frames;
    count+=frames.length;
  }
  if(!process.argv.includes('--check'))await writeFile(path,JSON.stringify(moves,null,2)+'\n');
  console.log(`${count} spin frames ${process.argv.includes('--check')?'verified':'baked'}; normal moves preserved.`);
} finally {await server.close();}
