/** Right jumping uppercut, two hits (straight punch, uppercut on takeoff); back-view apex from refs/referenz_1_uppercut_ruecken.png. */
import { createServer } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { PYTHON } from './python.mjs';
const server=await createServer({server:{middlewareMode:true,ws:false,hmr:false,watch:null},appType:'custom'});
try {
 const {buildPose}=await server.ssrLoadModule('/src/render/skeleton.ts');
 const {spinFrameBoxes}=await server.ssrLoadModule('/src/data/spin-boxes.ts');
 const pp=new URL('../src/data/poses.json',import.meta.url),mp=new URL('../src/data/moves.json',import.meta.url);
 const data=JSON.parse(await readFile(pp,'utf8')),moves=JSON.parse(await readFile(mp,'utf8'));
 const guard=structuredClone(data.poses.guard);guard.root=buildPose(guard,true).hip;
 const keys=[];
 // Drop earlier keyframe poses so renamed frames leave no orphans behind; the new
 // ones go back to the same place in poses.json (other generators compare its text).
 const poseOrder=Object.keys(data.poses);
 for(const name of poseOrder)if(name.startsWith('jumping_uppercut_'))delete data.poses[name];
 function key(frame,yaw,lift,neck,legs,arms) {
  const pose=structuredClone(guard);
  const leftShoulder=55+70*yaw/90,rightShoulder=125-160*yaw/90;
  Object.assign(pose.angles,{neck,head:-90-neck,leftShoulder:leftShoulder-neck,rightShoulder:rightShoulder-neck,
   leftKnee:legs[0],leftFoot:legs[1],rightKnee:legs[2],rightFoot:legs[3],
   leftElbow:arms[0]-leftShoulder,leftHand:arms[1]-arms[0],rightElbow:arms[2]-rightShoulder,rightHand:arms[3]-arms[2]});
  pose.root=buildPose(pose,true).hip;pose.root[1]-=lift;
  // Keep both feet planted while loading and absorbing the jump.
  const planted={7:2,11:9,39:4,43:9}[frame]; // hip drop: short punch stance, deep load, landing contact, absorb
  if(planted!==undefined) {
   const home=buildPose(guard,true);pose.root=[...home.hip];pose.root[1]+=planted;
   for(const side of ['left','right']) {
    const foot=home[side+'Foot'],dx=foot[0]-pose.root[0],dy=foot[1]-pose.root[1];
    const bend=Math.acos(Math.min(1,Math.hypot(dx,dy)/50));
    pose.angles[side+'Knee']=(Math.atan2(dy,dx)-bend)*180/Math.PI;
    pose.angles[side+'Foot']=2*bend*180/Math.PI;
   }
  }
  const name=`jumping_uppercut_${frame}`;data.poses[name]=pose;keys.push({frame,pose:name,easing:'smoothstep',yaw,turn:(1-Math.cos(yaw*Math.PI/180))/2});
 }
 const rest=(frame,yaw)=>{const name=`jumping_uppercut_${frame}`;data.poses[name]=structuredClone(guard);keys.push({frame,pose:name,easing:'smoothstep',yaw,turn:(1-Math.cos(yaw*Math.PI/180))/2});};
 rest(0,0);
 // Two hits: a straight right punch at chin height from the stance (hit 1), the
 // fist drops back to the chest while the hips load, then the takeoff drives the
 // same arm upwards into the uppercut (hit 2). Jump height is 1.5x the original
 // arc; the punching arm reaches the apex fully straight.
 key(7,0,0,-68,[0,0,0,0],[85,-65,-8,-10]); // punch: right arm straight forward at chin height
 key(11,0,0,-65,[0,0,0,0],[85,-65,80,-60]); // dip, right fist drawn back to the chest
 key(15,0,4,-78,[65,30,101,0],[100,-110,-32,-32]); // drive off both feet, arm extending upwards
 key(19,30,20,-94,[83,10,87,5],[120,-145,-45,-55]); // rising, arm opening towards straight
 key(22,70,38,-98,[115,-30,86,5],[130,-160,-68,-72]); // uppercut passes the head, arm extended
 key(26,90,35,-98,[125,-42,87,4],[135,-165,-86,-88]); // full back view, straight arm above the head
 key(29,90,30,-98,[125,-42,87,4],[135,-165,-86,-88]); // briefly retain the apex silhouette
 key(33,65,17,-87,[110,-25,100,-8],[115,-140,-55,-65]); // fall, arm lowering along the same line
 key(39,15,0,-73,[57,45,110,-10],[90,-85,45,-80]); // contact, arms returning close to the torso
 key(43,0,0,-68,[45,65,120,-28],[75,-55,75,-70]); // absorb landing in starting view
 rest(55,0);
 const id='jumping_uppercut';
 data.animations[id]={durationFrames:56,loop:false,grounded:false,clampFloor:true,fixedLegDepth:true,interpolation:'angles',keyframes:keys,trail:{joint:'rightHand',fromFrame:5,toFrame:26,historyFrames:3}};
 // Hit windows (move frames, inclusive): the punch, then the uppercut on takeoff.
 const HITS=[{group:'punch',from:6,to:8},{group:'main',from:14,to:21}];
 const move={...structuredClone(moves.find(m=>m.id==='standing_hp')),id,animation:id,command:{type:'hold',directions:[6],buttons:['HP'],trigger:'pressed',priority:10},
  startup:HITS[0].from,active:HITS.at(-1).to-HITS[0].from+1,recovery:55-HITS.at(-1).to,damage:75,hitstop:14,multiHit:true,
  // The punch barely pushes and stuns past the uppercut, so both hits connect (or are both blocked).
  hitGroups:[{id:'punch',maxHitsPerTarget:1,damage:25,hitstun:24,blockstun:16,hitstop:8,pushbackHit:512,pushbackBlock:512},{id:'main',maxHitsPerTarget:1}],
  advance:{frames:14,distance:12*256},frameRanges:[]};
 // Sample the same production interpolation without changing the live data in check mode.
 const runtime=await server.ssrLoadModule('/src/render/skeleton.ts');
 Object.assign(runtime.animations,{[id]:data.animations[id]});
 const raw=await server.ssrLoadModule('/src/data/poses.json');Object.assign(raw.default.poses,data.poses);
 for(let frame=0;frame<56;frame++) {
  const p=runtime.samplePose(id,frame),active=HITS.find(h=>frame>=h.from&&frame<=h.to);
  const boxes=spinFrameBoxes(p,false);
  if(active) {
   const points=[p.rightElbow,p.rightHand],margin=5;
   const x=Math.floor((Math.min(...points.map(p=>p[0]))-margin)*256),y=Math.floor((Math.min(...points.map(p=>p[1]))-margin)*256);
   boxes.hitboxes=[{x,y,width:Math.ceil((Math.max(...points.map(p=>p[0]))+margin)*256)-x,height:Math.ceil((Math.max(...points.map(p=>p[1]))+margin)*256)-y,hitGroup:active.group}];
  }
  move.frameRanges.push({from:frame,to:frame,...boxes});
 }
 const fresh=Object.entries(data.poses).filter(([name])=>name.startsWith(id+'_'));
 data.poses=Object.fromEntries(poseOrder.flatMap(name=>!name.startsWith(id+'_')?[[name,data.poses[name]]]:name===poseOrder.find(n=>n.startsWith(id+'_'))?fresh:[]));
 const old=moves.findIndex(m=>m.id===id);if(old<0)moves.push(move);else moves[old]=move;
 for(const [path,value] of [[pp,data],[mp,moves]]) {
  const result=JSON.stringify(value,null,2)+'\n';
  if(process.argv.includes('--check')){if(JSON.stringify(value)!==JSON.stringify(JSON.parse(await readFile(path,'utf8'))))throw Error('Jumping uppercut data is stale');}
  else if(path===pp) {
   const patch={poses:Object.fromEntries(Object.entries(data.poses).filter(([name])=>name.startsWith(id+'_'))),animations:{[id]:data.animations[id]}};
   await new Promise((resolve,reject)=>{
    const child=execFile(PYTHON,['-c',"import json,sys; from pathlib import Path; p=Path(sys.argv[1]); data=json.loads(p.read_text()); patch=json.load(sys.stdin); old=[k for k in data['poses'] if k.startswith('jumping_uppercut_')]; data['poses']={n:v for k,x in data['poses'].items() for n,v in (patch['poses'].items() if k==old[0] else [] if k in old else [(k,x)])}; data['animations'].update(patch['animations']); p.write_text(json.dumps(data,indent=2)+'\\n')",path.pathname],error=>error?reject(error):resolve(undefined));
    child.stdin.end(JSON.stringify(patch));
   });
  }else await writeFile(path,result);
 }
 console.log('Right jumping uppercut poses and boxes synchronized.');
}finally{await server.close();}
