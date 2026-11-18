// Compose the existing two spins, retaining their authored recovery and startup.
import {readFile,writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import { PYTHON } from './python.mjs';
const root=new URL('../src/data/',import.meta.url);
const moves=JSON.parse(await readFile(new URL('moves.json',root),'utf8'));
const poses=JSON.parse(await readFile(new URL('poses.json',root),'utf8'));
const id='spin_high_middle_combo',high=moves.find(m=>m.id==='spin_hk'),middle=moves.find(m=>m.id==='spin_mk');
const a=poses.animations.spin_hk,b=poses.animations.spin_mk,offset=a.durationFrames-1;
const end=offset+middle.startup+middle.active;
poses.animations[id]={...a,durationFrames:offset+b.durationFrames,
 keyframes:[...a.keyframes,...b.keyframes.slice(1).map(k=>({...k,frame:k.frame+offset,yaw:(k.yaw??0)-360}))],
 trails:[a.trail,{...b.trail,fromFrame:b.trail.fromFrame+offset,toFrame:b.trail.toFrame+offset}]};
delete poses.animations[id].trail;
const ranges=(move,shift,group)=>move.frameRanges.map(r=>({...r,from:r.from+shift,to:r.to+shift,hitboxes:r.hitboxes.map(h=>({...h,hitGroup:group}))}));
const move={...high,id,button:'MK',animation:id,
 command:{type:'hold',directions:[6],buttons:['RLK','MK'],trigger:'pressed',priority:30},
 active:end-high.startup,recovery:middle.recovery,damage:high.damage+middle.damage,multiHit:true,
 hitGroups:[{id:'high',maxHitsPerTarget:1,damage:high.damage,hitLevel:high.hitLevel,hitstun:40,pushbackHit:0,pushbackBlock:0},
 {id:'middle',maxHitsPerTarget:1,damage:middle.damage,hitLevel:middle.hitLevel,hitstun:middle.hitstun,blockstun:middle.blockstun,pushbackHit:middle.pushbackHit,pushbackBlock:middle.pushbackBlock}],
 frameRanges:[...ranges(high,0,'high').filter(r=>r.to<offset),...ranges(middle,offset,'middle')]};
const index=moves.findIndex(m=>m.id===id);if(index<0)moves.push(move);else moves[index]=move;
for(const [name,data] of [['moves.json',moves],['poses.json',poses]]) {
 const path=new URL(name,root),text=JSON.stringify(data,null,2)+'\n';
 if(process.argv.includes('--check')) {if(JSON.stringify(JSON.parse(await readFile(path,'utf8')))!==JSON.stringify(data))throw Error(`${id} stale: npm run generate:spin-high-middle`);}
 else if(name==='poses.json') await new Promise((resolve,reject)=>{
  const child=execFile(PYTHON,['-c',"import json,sys; from pathlib import Path; p=Path(sys.argv[1]); data=json.loads(p.read_text()); data['animations'].update(json.load(sys.stdin)); p.write_text(json.dumps(data,indent=2)+'\\n')",path.pathname],error=>error?reject(error):resolve(undefined));
  child.stdin.end(JSON.stringify({[id]:poses.animations[id]}));
 });
 else await writeFile(path,text);
}
console.log('Spin high → middle combo synchronized.');
