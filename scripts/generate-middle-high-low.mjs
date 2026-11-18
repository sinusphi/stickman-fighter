/** Standing right middle → chambered right high → standing left low. */
import { readFile } from 'node:fs/promises';
import { generateKick } from './kicks/generate.mjs';
import { toAbsolute } from './kicks/rig.mjs';
const data=JSON.parse(await readFile(new URL('../src/data/poses.json',import.meta.url),'utf8'));
await generateKick(G=>{
 const ground=foot=>({foot,knee:1,space:'ground'});
 const advance={frames:41,distance:40};
 const offset=f=>{const t=Math.min(1,f/advance.frames);return advance.distance*t*t*(3-2*t);};
 const travel=new Map([[0,0],[8,2],[15,7],[17,8],[19,9],[24,11],[26,13],
  [29,17],[31,19],[34,22],[38,30],[39,33],[41,38],[48,40],[51,41],[53,42],
  [56,42],[61,41],[66,40]]);
 const hip=(f,height=-49)=>[travel.get(f)-offset(f),height];
 const leftPlant=16,rightPlant=44;
 const pose=(f,name,support='left',supportFoot=support==='left'?(f===8?13:leftPlant):G.rightFoot[0])=>{
  const p=toAbsolute(data.poses[name]);
  return {f,...p,hip:hip(f),[support]:ground([supportFoot,0])};
 };
 const home=(f,left=G.leftFoot[0],right=G.rightFoot[0])=>({f,...G,hip:hip(f,f===0?-47:-49),left:ground([left,0]),right:ground([right,0])});
 const high=f=>({...pose(f,'standing_rhk'),hip:hip(f,-49.8),torso:-86,head:-81,
  right:{thigh:-43,shin:-38}});
 const keys=[home(0),pose(8,'standing_mk_pass'),pose(15,'standing_mk_anticipate'),
  {...pose(17,'standing_mk'),torso:-94,head:-85},
  {...pose(19,'standing_mk'),torso:-94,head:-85},
  // The thigh stays raised while only the lower leg folds back. No landing.
  pose(24,'standing_mk_anticipate'),pose(26,'standing_rhk_anticipate'),
  high(29),high(31),{...pose(34,'standing_rhk_return'),torso:-88,head:-80},
  {...pose(38,'standing_rhk_repass'),hip:hip(38,-46),right:ground([rightPlant,0])},
  {f:39,hip:hip(39),shoulders:toAbsolute(data.poses.standing_rhk_repass).shoulders,
   left:{foot:[23,-6],knee:1,space:'ground'},right:ground([rightPlant,0])},
  home(41,30,rightPlant),
  pose(48,'standing_lk_anticipate','right',rightPlant),
  pose(51,'standing_lk','right',rightPlant),
  pose(53,'standing_lk','right',rightPlant),
  pose(56,'standing_lk_follow','right',rightPlant),
  pose(61,'standing_lk_return','right',34),
  home(66,G.leftFoot[0]+advance.distance,G.rightFoot[0]+advance.distance)];
 return {id:'middle_high_low_combo',button:'MK',buttons:['LMK','MK'],direction:6,duration:67,
  advance,
  frame:{startup:17,active:37,recovery:13},kickFoot:'rightFoot',
  hit:{damage:65,hitLevel:'MID',hitstun:30,blockstun:18,pushbackHit:0,pushbackBlock:0,hitstop:9},
  strikes:[{from:17,to:19,joint:'rightFoot',group:'middle'},
   {from:29,to:31,joint:'rightFoot',group:'high',hit:{damage:95,hitLevel:'HIGH',hitstun:35}},
   {from:51,to:53,joint:'leftFoot',group:'low',hit:{damage:35,hitLevel:'LOW',hitstun:18,blockstun:13,pushbackHit:5632,pushbackBlock:4096}}],
  shoulders:(_,f)=>{
   const i=Math.max(0,keys.findIndex((_,i)=>i+1<keys.length&&f<=keys[i+1].f));
   const a=keys[i],b=keys[i+1],t=(f-a.f)/(b.f-a.f);
   return Object.fromEntries(['l','r'].map(s=>[s,a.shoulders[s]+(b.shoulders[s]-a.shoulders[s])*t]));
  },keys};
});
