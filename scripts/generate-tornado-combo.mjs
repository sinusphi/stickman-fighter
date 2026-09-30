/** Reference: refs/tornado-kick-spin-kick-combo.mp4, STEP 5 (16.5–20.8 s).
 * Bake the knee-led jump, right roundhouse, landing pivot and left high hook.
 * Continuous yaw drives shoulders and eyes; each arm has its own authored path.
 */
import { createServer } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
const server=await createServer({server:{middlewareMode:true,ws:false,hmr:false,watch:null},appType:'custom'});
try {
 const {blendAngles,buildPose,lerpAngle}=await server.ssrLoadModule('/src/render/skeleton.ts');
 const {spinFrameBoxes}=await server.ssrLoadModule('/src/data/spin-boxes.ts');
 const posePath=new URL('../src/data/poses.json',import.meta.url),movePath=new URL('../src/data/moves.json',import.meta.url);
 const data=JSON.parse(await readFile(posePath,'utf8')),moves=JSON.parse(await readFile(movePath,'utf8'));
 const guard=data.poses.guard;
 // Absolute thigh angles, relative knee bends; arm counterbalance follows yaw.
 const key=(frame,yaw,lift,neck,leftKnee,leftFoot,rightKnee,rightFoot)=>({frame,yaw,lift,pose:{root:[0,0],angles:{...guard.angles,
  neck,head:-90-neck,leftShoulder:55-neck,rightShoulder:125-neck,
  leftElbow:-20,leftHand:-100,rightElbow:10,rightHand:-165,
  leftKnee,leftFoot,rightKnee,rightFoot}}});
 const rest=(frame,yaw=0)=>({frame,yaw,lift:0,pose:structuredClone(guard)});
 // Lift the lead knee, then lower it under the hip during the kick.
 // Extend the non-kicking leg as it lowers, instead of leaving an 85-degree
 // knee bend beneath the body. The hip's independent arc prevents a kneel.
 const tornado=[rest(0),key(6,45,0,-86,75,25,115,-45),key(12,110,0,-82,35,85,90,10),
  key(18,205,8,-94,-55,110,70,35),key(21,245,14,-100,15,70,20,95),
  key(24,285,16,-104,65,30,-40,130),key(26,320,12,-108,80,20,-30,65),
  key(28,350,8,-110,90,15,-20,10),key(32,360,2,-105,90,15,-10,15),
  key(38,360,0,-88,140,-65,85,20)];
 // Turn on the planted right leg without chambering the left knee. The nearly
 // straight kick leg first passes behind the back-facing torso, then drives
 // forward onto the opponent's head line. At contact both legs are fully
 // extended, matching the reference.
 const spin=[rest(0),key(6,45,0,-88,95,0,90,0),key(12,70,0,-76,135,5,90,0),
  key(18,105,0,-140,-145,5,90,0),key(24,285,0,-162,-45,0,90,0),
  key(29,360,0,-160,-45,0,90,0),key(36,360,0,-130,-40,100,90,0),rest(46,360)];
 // Independent absolute upper-arm/forearm angles. The leading arm gathers
 // first; the other follows, then stays folded near the head during the kick.
 // Separate keys also let recovery release one arm before the other.
 const authorArms=(keys,tracks)=>keys.forEach((k,i)=>{k.arms=tracks[i];});
 authorArms(tornado,[null,[45,-75,135,-135],[100,-35,155,-110],
  [145,-80,65,-125],[110,-105,30,-100],[65,-65,125,-100],
  [50,-80,145,-90],[40,-105,140,-90],[35,-100,125,-100],
  [55,-85,105,-100]]);
 authorArms(spin,[null,[50,-80,130,-135],[145,-80,155,-105],
  [80,-100,55,-70],[60,-65,145,-90],[50,-80,125,-100],
  [40,-95,105,-95],null]);
 const armAngles=k=>k.arms??['left','right'].flatMap(side=>{
  const a=k.pose.angles,upper=a.neck+a[side+'Shoulder']+a[side+'Elbow'];
  return [upper,upper+a[side+'Hand']];
 });
 // High kicks share the standing middle kick's startup/contact/recovery clock.
 // Keep the reference motion and damage; compress each phase independently.
 const middle=moves.find(m=>m.id==='standing_mk');
 const spinEnd=middle.startup+middle.active-1;
 const spinTime=f=>Math.round(f<=24?f/24*middle.startup:f<=29?middle.startup+(f-24)/5*(middle.active-1):spinEnd+(f-29)/17*middle.recovery);
 for(const k of spin)k.frame=spinTime(k.frame);
 const definitions=[
  {id:'tornado_mk',button:'MK',buttons:['MK'],keys:[...tornado,rest(54,360)],trails:[{joint:'rightFoot',fromFrame:6,toFrame:32,historyFrames:5,directional:true}],hits:[{from:28,to:32,side:'right',id:'tornado',hitLevel:'MID',damage:80}]},
  {id:'forward_spin_hk',button:'HK',buttons:['HK'],keys:spin,trails:[{joint:'leftFoot',fromFrame:spinTime(6),toFrame:spinEnd,historyFrames:5,directional:true}],hits:[{from:middle.startup,to:spinEnd,side:'left',id:'spin',hitLevel:'HIGH',damage:100}]},
  {id:'tornado_spin_combo',button:'HK',buttons:['MK','HK'],keys:[...tornado.slice(0,-1),...spin.slice(1).map(k=>({...k,frame:k.frame+32,yaw:k.yaw+360}))],
   trails:[{joint:'rightFoot',fromFrame:6,toFrame:32,historyFrames:5,directional:true},{joint:'leftFoot',fromFrame:32+spinTime(6),toFrame:32+spinEnd,historyFrames:5,directional:true}],
   hits:[{from:28,to:32,side:'right',id:'tornado',hitLevel:'MID',damage:80},{from:32+middle.startup,to:32+spinEnd,side:'left',id:'spin',hitLevel:'HIGH',damage:100}]},
 ];
 for(const def of definitions) {
  const duration=def.keys.at(-1).frame+1,keyframes=[],ranges=[];
  for(let frame=0;frame<duration;frame++) {
   const next=def.keys.findIndex(k=>k.frame>frame),a=def.keys[next<0?def.keys.length-1:Math.max(0,next-1)],b=def.keys[next<0?def.keys.length-1:next];
   const t=a===b?0:(frame-a.frame)/(b.frame-a.frame),smooth=t*t*(3-2*t);
   const pose=blendAngles(a.pose,b.pose,smooth),yaw=a.yaw+(b.yaw-a.yaw)*smooth,lift=a.lift+(b.lift-a.lift)*smooth;
   // Quantize the derived turn: Math.cos can differ in its last bit between
   // Node/V8 versions, which must not invalidate otherwise identical assets.
   const radians=yaw*Math.PI/180,turn=Number(((1-Math.cos(radians))/2).toFixed(12));
   // Shoulder placement follows yaw; elbows and hands follow independent tracks.
   // Blend out into the authored guard; never stretch a skeletal segment.
   const envelope=Math.min(1,frame/6,(duration-1-frame)/10);
   const c=Math.cos(radians);
   const degrees=(x,y)=>Math.atan2(y,x)*180/Math.PI;
   const neck=pose.angles.neck;
   const shoulderL=degrees(c*.82,.57),shoulderR=degrees(-c*.82,.57);
   const fromArms=armAngles(a),toArms=armAngles(b);
   const [upperL,foreL,upperR,foreR]=fromArms.map((angle,i)=>lerpAngle(angle,toArms[i],smooth));
   const arms={...pose,angles:{...pose.angles,
    leftShoulder:shoulderL-neck,rightShoulder:shoulderR-neck,
    leftElbow:upperL-shoulderL,rightElbow:upperR-shoulderR,
    leftHand:foreL-upperL,rightHand:foreR-upperR}};
   Object.assign(pose,blendAngles(pose,arms,envelope*envelope*(3-2*envelope)));
   // During the jump, the hip follows its own arc. Re-grounding each tucked
   // pose makes the body fall whenever the non-kicking leg folds upward.
   const grounded=buildPose(pose,true);
   const jump=def.id!=='forward_spin_hk' && frame<=38;
   const hipHeight=k=>k.frame>=12&&k.frame<=32?-49:buildPose(k.pose,true).hip[1];
   pose.root=[grounded.hip[0],(jump?hipHeight(a)+(hipHeight(b)-hipHeight(a))*smooth:grounded.hip[1])-lift];
   const name=`${def.id}_${frame}`;data.poses[name]=pose;
   keyframes.push({frame,pose:name,easing:'linear',turn,yaw});
   const hit=def.hits.find(h=>frame>=h.from&&frame<=h.to);
   ranges.push({from:frame,to:frame,...spinFrameBoxes(buildPose(pose,false,1,false,true),Boolean(hit),hit?.side??'right',hit?.id??'main')});
  }
  data.animations[def.id]={durationFrames:duration,loop:false,grounded:false,clampFloor:true,interpolation:'angles',trails:def.trails,keyframes};
  const first=def.hits[0],last=def.hits.at(-1),combo=def.hits.length===2;
  const move={schemaVersion:1,id:def.id,stance:'standing',button:def.button,
   command:{type:'hold',directions:[def.id==='forward_spin_hk'?4:6],buttons:def.buttons,trigger:'pressed',priority:combo?30:20},animation:def.id,
   startup:first.from,active:last.to-first.from+1,recovery:duration-last.to-1,damage:first.damage,hitLevel:first.hitLevel,
   hitstun:combo?42:28,blockstun:combo?32:20,pushbackHit:(combo?6:20)*256,pushbackBlock:6*256,hitstop:def.id==='forward_spin_hk'?middle.hitstop:9,
   advance:{frames:Math.min(18,first.from),distance:18*256},airHitReaction:'knockdown',multiHit:combo,
   hitGroups:def.hits.map(h=>({id:h.id,maxHitsPerTarget:1,hitLevel:h.hitLevel,damage:h.damage})),
   cancelWindows:[],combo:{scalingPermille:1000,juggleCost:0,juggleLimit:0},frameRanges:ranges};
  const index=moves.findIndex(m=>m.id===def.id);if(index<0)moves.push(move);else moves[index]=move;
 }
 for(const [path,value] of [[posePath,data],[movePath,moves]]) {
  if(process.argv.includes('--check')) {
   if(JSON.stringify(JSON.parse(await readFile(path,'utf8')))!==JSON.stringify(value))throw Error(`${path.pathname}: tornado data are stale`);
  }else if(path===posePath) {
   // Preserve the Python walk generator's canonical formatting and untouched
   // numeric values (including authored 1.0 values) in the shared pose file.
   const ids=definitions.map(d=>d.id);
   const patch={poses:Object.fromEntries(Object.entries(data.poses).filter(([id])=>ids.some(prefix=>id.startsWith(prefix+'_')))),animations:Object.fromEntries(ids.map(id=>[id,data.animations[id]]))};
   await new Promise((resolve,reject)=>{
    const child=execFile('python',['-c',"import json,sys; from pathlib import Path; p=Path(sys.argv[1]); data=json.loads(p.read_text()); patch=json.load(sys.stdin); [data[k].update(v) for k,v in patch.items()]; p.write_text(json.dumps(data,indent=2)+'\\n')",path.pathname],(error)=>error?reject(error):resolve());
    child.stdin.end(JSON.stringify(patch));
   });
  }else await writeFile(path,JSON.stringify(value,null,2)+'\n');
 }
 console.log('Tornado, left spin and two-hit combo poses/boxes synchronized.');
}finally {await server.close();}
