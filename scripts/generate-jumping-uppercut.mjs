/** Right jumping uppercut; back-view apex from refs/referenz_1_uppercut_ruecken.png. */
import { createServer } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
const server=await createServer({server:{middlewareMode:true,ws:false,hmr:false,watch:null},appType:'custom'});
try {
 const {buildPose}=await server.ssrLoadModule('/src/render/skeleton.ts');
 const {spinFrameBoxes}=await server.ssrLoadModule('/src/data/spin-boxes.ts');
 const pp=new URL('../src/data/poses.json',import.meta.url),mp=new URL('../src/data/moves.json',import.meta.url);
 const data=JSON.parse(await readFile(pp,'utf8')),moves=JSON.parse(await readFile(mp,'utf8'));
 const guard=structuredClone(data.poses.guard);guard.root=buildPose(guard,true).hip;
 const keys=[];
 function key(frame,yaw,lift,neck,legs,arms) {
  const pose=structuredClone(guard);
  const leftShoulder=55+70*yaw/90,rightShoulder=125-160*yaw/90;
  Object.assign(pose.angles,{neck,head:-90-neck,leftShoulder:leftShoulder-neck,rightShoulder:rightShoulder-neck,
   leftKnee:legs[0],leftFoot:legs[1],rightKnee:legs[2],rightFoot:legs[3],
   leftElbow:arms[0]-leftShoulder,leftHand:arms[1]-arms[0],rightElbow:arms[2]-rightShoulder,rightHand:arms[3]-arms[2]});
  pose.root=buildPose(pose,true).hip;pose.root[1]-=lift;
  // Keep both feet planted while loading and absorbing the jump.
  if([7,38,42].includes(frame)) {
   const home=buildPose(guard,true);pose.root=[...home.hip];pose.root[1]+=(frame===38?4:9); // deeper absorb for the higher jump
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
 key(7,0,0,-65,[48,65,117,-25],[85,-65,100,-25]); // dip, right fist gathered near waist
 // Jump height is 1.5x the original arc; the punching arm extends on the way up
 // and reaches the apex fully straight instead of folding over the head.
 key(11,0,0,-78,[65,30,101,0],[100,-110,70,-45]); // drive off both feet, fist leaves the waist
 key(15,30,20,-94,[83,10,87,5],[120,-145,-38,-50]); // rising, arm opening towards straight
 key(20,70,38,-98,[115,-30,86,5],[130,-160,-68,-72]); // uppercut passes the head, arm extended
 key(25,90,35,-98,[125,-42,87,4],[135,-165,-86,-88]); // full back view, straight arm above the head
 key(28,90,30,-98,[125,-42,87,4],[135,-165,-86,-88]); // briefly retain the apex silhouette
 key(32,65,17,-87,[110,-25,100,-8],[115,-140,-55,-65]); // fall, arm lowering along the same line
 key(38,15,0,-73,[57,45,110,-10],[90,-85,45,-80]); // contact, arms returning close to the torso
 key(42,0,0,-68,[45,65,120,-28],[75,-55,75,-70]); // absorb landing in starting view
 rest(55,0);
 const id='jumping_uppercut';
 data.animations[id]={durationFrames:56,loop:false,grounded:false,clampFloor:true,fixedLegDepth:true,interpolation:'angles',keyframes:keys,trail:{joint:'rightHand',fromFrame:10,toFrame:25,historyFrames:3}};
 const move={...structuredClone(moves.find(m=>m.id==='standing_hp')),id,animation:id,command:{type:'hold',directions:[6],buttons:['HP'],trigger:'pressed',priority:10},startup:12,active:9,recovery:35,hitstop:14,advance:{frames:12,distance:12*256},frameRanges:[]};
 // Sample the same production interpolation without changing the live data in check mode.
 const runtime=await server.ssrLoadModule('/src/render/skeleton.ts');
 Object.assign(runtime.animations,{[id]:data.animations[id]});
 const raw=await server.ssrLoadModule('/src/data/poses.json');Object.assign(raw.default.poses,data.poses);
 for(let frame=0;frame<56;frame++) {
  const p=runtime.samplePose(id,frame),active=frame>=12&&frame<21;
  const boxes=spinFrameBoxes(p,false);
  if(active) {
   const points=[p.rightElbow,p.rightHand],margin=5;
   const x=Math.floor((Math.min(...points.map(p=>p[0]))-margin)*256),y=Math.floor((Math.min(...points.map(p=>p[1]))-margin)*256);
   boxes.hitboxes=[{x,y,width:Math.ceil((Math.max(...points.map(p=>p[0]))+margin)*256)-x,height:Math.ceil((Math.max(...points.map(p=>p[1]))+margin)*256)-y,hitGroup:'main'}];
  }
  move.frameRanges.push({from:frame,to:frame,...boxes});
 }
 const old=moves.findIndex(m=>m.id===id);if(old<0)moves.push(move);else moves[old]=move;
 for(const [path,value] of [[pp,data],[mp,moves]]) {
  const result=JSON.stringify(value,null,2)+'\n';
  if(process.argv.includes('--check')){if(JSON.stringify(value)!==JSON.stringify(JSON.parse(await readFile(path,'utf8'))))throw Error('Jumping uppercut data is stale');}
  else if(path===pp) {
   const patch={poses:Object.fromEntries(Object.entries(data.poses).filter(([name])=>name.startsWith(id+'_'))),animations:{[id]:data.animations[id]}};
   await new Promise((resolve,reject)=>{
    const child=execFile('python',['-c',"import json,sys; from pathlib import Path; p=Path(sys.argv[1]); data=json.loads(p.read_text()); patch=json.load(sys.stdin); [data[k].update(v) for k,v in patch.items()]; p.write_text(json.dumps(data,indent=2)+'\\n')",path.pathname],error=>error?reject(error):resolve());
    child.stdin.end(JSON.stringify(patch));
   });
  }else await writeFile(path,result);
 }
 console.log('Right jumping uppercut poses and boxes synchronized.');
}finally{await server.close();}
