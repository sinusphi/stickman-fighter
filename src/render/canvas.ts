import { FIGURE_SCALE } from '../data/figure-scale';
import { guardBreakGlow } from './guard-break';
import rules from '../data/rules.json';
import type { GameState } from '../simulation/types';
import { localBoxes } from '../simulation/combat';
import { worldBox, type Box } from '../simulation/collision';
import { fighterPose, isKneeTrail, sampleTrails, sampleRotationTrail, animationTrails, sampleTurn, sampleHeadYaw, MIRROR_YAW_ANIMATIONS, animationId, animations, victoryYaw } from './skeleton';
import { drawFigure, drawTrail } from './figure';
import { fighterDepths } from './depth';
import { facePoint } from './facing';
import { drawKneeImpact, drawKneeSwoosh, kneeImpact } from './impact';
import { MOVES, throwData, type HitLevel } from '../data/schema';
import { localGrabBox } from '../simulation/throws';
import type { Palette } from '../platform/theme';
import { RELAX_FRAMES } from './feedback';
import type { HitEffects } from './effects';
import { t } from '../platform/i18n';
import { INTRO_FIGHT_FRAMES, INTRO_READY_FRAMES } from '../simulation/intro';
import { DEFAULT_STAGE, STAGE_VIEW, drawContactShadow, drawStage, stagePan, type StageId } from './stages';
export { samplePose } from './skeleton';

const ground = STAGE_VIEW.ground;

/** Victim offset (subpixels) relative to the thrower's drawn position at `moveFrame + alpha`, or null. */
export function thrownOffset(game: GameState, f: GameState['fighters'][number], alpha: number): [number,number] | null {
  const thrower=game.fighters[1-f.id],data=f.state==='Thrown'?throwData(thrower.moveId):undefined;
  if(!data?.path || thrower.state!=='Attack')return null;
  const last=data.impactFrame!,time=Math.min(last,thrower.moveFrame+alpha),i=Math.min(last,Math.floor(time)),j=Math.min(last,i+1),t=time-i;
  // Integer frames reproduce the simulation exactly, including a wall shift.
  const base=f.x-thrower.x-thrower.attackFacing*data.path[i][0];
  return [base+thrower.attackFacing*(data.path[i][0]+(data.path[j][0]-data.path[i][0])*t),data.path[i][1]+(data.path[j][1]-data.path[i][1])*t];
}

export function render(canvas: HTMLCanvasElement, game: GameState, previous: GameState, alpha: number, paused: boolean, boxes: boolean, palette: Palette, hitLevels: (HitLevel | undefined)[] = [], koFrames?: number[], stage: StageId = DEFAULT_STAGE, demo = false, relaxFrames?: number[], effects?: HitEffects, victoryFrames?: number[]): void {
  const ctx = canvas.getContext('2d')!;
  // The backing store may be larger than 960x420 (see fitCanvas); all drawing stays in logical units.
  const scale=(canvas.width||960)/960;
  if(scale!==1)ctx.setTransform(scale,0,0,scale,0,0);
  ctx.clearRect(0, 0, 960, 420);
  // Presentation-only camera: shake offset and KO zoom around the stage and fighters.
  const camera=effects?.camera(paused);
  if(camera){ctx.save();ctx.translate(camera.cx+camera.x,camera.cy+camera.y);ctx.scale(camera.zoom,camera.zoom);ctx.translate(-camera.cx,-camera.cy);}
  const effectAlpha=paused?0:alpha;
  const impact=game.hitstop>0?game.lastContact?.poses:undefined;
  const displayFighters=game.fighters.map((f,i)=>impact?{...f,...impact[i]}:f);
  const poseLevels=impact?impact.map(p=>p.hitLevel):hitLevels;
  // The stage follows the interpolated fighter midpoint with a slight parallax.
  const screenX=(f: GameState['fighters'][number])=>(impact?f.x:previous.fighters[f.id].x+(f.x-previous.fighters[f.id].x)*alpha)/rules.unit;
  drawStage(ctx,stage,palette,stagePan((screenX(displayFighters[0])+screenX(displayFighters[1]))/2),scale);
  ctx.font = '10px monospace'; ctx.fillStyle = palette.muted;
  // The turning attacker passes in front of the opponent at close contact.
  const turnFor=(f: GameState['fighters'][number])=>sampleTurn(animationId(f,poseLevels[f.id]),(f.state==='Attack'?f.moveFrame:f.stateFrame)+(game.hitstop||paused?0:alpha));
  const drawOrder=[...displayFighters].sort((a,b)=>Number(turnFor(a)>=.5)-Number(turnFor(b)>=.5)).map(f=>{
    const old = impact?f:previous.fighters[f.id];
    let x = screenX(f);
    const koTime=f.state==='KO'?(koFrames?.[f.id]??f.stateFrame)+(game.hitstop||paused?0:alpha):undefined;
    // A round-ending aerial KO must settle visually even while combat is frozen.
    const fall=koTime===undefined?1:Math.max(0,1-koTime/23);
    let y = ground + (old.y + (f.y - old.y) * alpha) / rules.unit*fall;
    // A thrown fighter hangs on the thrower's hands: take its sub-frame position
    // from the throw table at the same time the thrower's pose is sampled.
    const held=thrownOffset(game,f,game.hitstop||paused?0:alpha);
    if(held){x=screenX(displayFighters[1-f.id])+held[0]/rules.unit;y=ground+held[1]/rules.unit;}
    // The winner lowers his arms while the loser's fall plays out.
    const relaxed = relaxFrames?.[f.id] ?? 0;
    const relax = koTime===undefined && relaxed>0 ? Math.min(1,(relaxed+(game.hitstop||paused?0:alpha))/RELAX_FRAMES) : 0;
    // The match winner instead turns to the viewer and raises a fist.
    const celebrating = victoryFrames?.[f.id] ?? 0;
    const victory = koTime===undefined && celebrating>0 ? celebrating+(game.hitstop||paused?0:alpha) : 0;
    const pose = fighterPose(f,old,alpha,Boolean(game.hitstop || paused),poseLevels[f.id],koTime,relax,victory);
    // Attackers keep their attack facing; a thrown fighter keeps facing the thrower.
    const facing=f.state==='Attack'||f.state==='Thrown'?f.attackFacing:f.facing;
    return {f,x,y,koTime,pose,facing,victory};
  });
  effects?.drawBehind(ctx,game,previous,effectAlpha,palette);
  // Contact shadows first, so neither shadow covers the other fighter's feet.
  for (const {x,y,pose,facing} of drawOrder) {
    const xs=Object.values(pose).map(p=>p[0]*facing*FIGURE_SCALE),bottom=Math.max(...Object.values(pose).map(p=>p[1]))*FIGURE_SCALE;
    drawContactShadow(ctx,x+(Math.min(...xs)+Math.max(...xs))/2,(Math.max(...xs)-Math.min(...xs))/2,ground-(y+bottom),palette);
  }
  for (const {f,x,y,koTime,pose,facing,victory} of drawOrder) {
    ctx.save(); ctx.translate(x, y);
    ctx.scale(FIGURE_SCALE,FIGURE_SCALE);
    const color=f.id===0?palette.p1:palette.p2;
    if(f.state==='Attack' && f.moveId) {
      const time=f.moveFrame+(game.hitstop||paused?0:alpha),trails=animationTrails(f.moveId),samples=sampleTrails(f.moveId,time);
      trails.forEach((trail,index)=>{
        if(isKneeTrail(trail))return;
        const fade=Math.min(1,Math.max(0,(trail.toFrame+trail.historyFrames-time)/trail.historyFrames));
        drawTrail(ctx,samples[index],color,fade*(trail.directional?1:.68),trail.directional??false,facing,trail.directional?palette.revenge:palette.special);
      });
      drawTrail(ctx,sampleRotationTrail(f.moveId,time),palette.revenge,.72,true,facing,palette.special);
    }
    const actual=game.fighters[f.id];
    const flash=Math.max(hitLevels[f.id] && ['Hitstun','Knockdown','KO'].includes(actual.state)?Math.max(0,1-(koTime??actual.stateFrame)/3):0,guardBreakGlow(game.guardBreak,game.hitstop,f.id));
    const id=animationId(f,poseLevels[f.id]);
    drawFigure(ctx,pose,color,palette,facing,flash,fighterDepths(f,alpha,Boolean(game.hitstop||paused),poseLevels[f.id]),turnFor(f),victory>0?victoryYaw(victory):sampleHeadYaw(id,(f.state==='Attack'?f.moveFrame:f.stateFrame)+(game.hitstop||paused?0:alpha)),animations[id].fixedLegDepth,MIRROR_YAW_ANIMATIONS.has(id));
    if(f.state==='Attack' && f.moveId)drawKneeSwoosh(ctx,f.moveId,f.moveFrame+(game.hitstop||paused?0:alpha),facing,color,palette);
    if(f.state==='Attack' && f.moveId)for(const trail of animationTrails(f.moveId))
      if(trail.directional && f.moveFrame>=trail.fromFrame && f.moveFrame<=trail.toFrame) {
        const anchor=facePoint(pose[trail.joint],facing);ctx.fillStyle=palette.special;ctx.globalAlpha=.85;
        ctx.beginPath();ctx.arc(anchor[0],anchor[1],3.2,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
      }
    ctx.restore();
  }
  // Knee contact before a kick: burst at the kneecap during its hitstop, above
  // both silhouettes because the knee sinks into the opponent at contact.
  for (const {f,x,y,pose,facing} of drawOrder) {
    const knee=kneeImpact(game,f,paused?0:alpha);
    if(!knee)continue;
    ctx.save();ctx.translate(x,y);ctx.scale(FIGURE_SCALE,FIGURE_SCALE);
    drawKneeImpact(ctx,facePoint(pose[knee.joint],facing),knee,palette);
    ctx.restore();
  }
  effects?.drawWorld(ctx,effectAlpha,palette);
  // Debug geometry stays above both silhouettes, including close-range overlaps.
  if (boxes) for (const f of displayFighters) {
    const body = localBoxes(f);
    const paint = (box: Box, color: string, label: string) => {
      const b = worldBox(box, f, f.state === 'Attack' ? f.attackFacing : f.facing);
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1;
      ctx.globalAlpha=palette.boxAlpha;
      ctx.fillRect(b.x/rules.unit, ground+b.y/rules.unit, b.width/rules.unit,b.height/rules.unit);
      ctx.globalAlpha=1;
      ctx.strokeStyle=palette.arena;ctx.lineWidth=3;
      ctx.strokeRect(b.x/rules.unit, ground+b.y/rules.unit, b.width/rules.unit,b.height/rules.unit);
      ctx.strokeStyle=color;ctx.lineWidth=1;
      ctx.strokeRect(b.x/rules.unit, ground+b.y/rules.unit, b.width/rules.unit,b.height/rules.unit);
      ctx.font='8px monospace';ctx.fillStyle=palette.arena;
      ctx.fillRect(b.x/rules.unit-1,ground+b.y/rules.unit-10,ctx.measureText(label).width+2,9);
      ctx.fillStyle=color;ctx.fillText(label,b.x/rules.unit,ground+b.y/rules.unit-2);
    };
    body.hurtboxes.forEach(b => paint(b,palette.hurt,'HURT'));
    paint(body.pushbox,palette.push,'PUSH');
    body.hitboxes.forEach(b => paint(b,palette.hit,'HIT'));
    // Throw attempts: the grab range up to and including the grab frame.
    const attempt=f.state==='Attack' && f.moveId?MOVES[f.moveId]:undefined;
    if(attempt?.throw?.phase==='attempt' && f.moveFrame<=attempt.startup)paint(localGrabBox(attempt),palette.hit,f.moveFrame===attempt.startup?'GRAB!':'GRAB');
  }
  if(camera)ctx.restore();
  effects?.drawOverlay(ctx,palette);
  // Overlay text keeps an arena-coloured halo so it stays readable on every stage.
  const banner=(text: string,y: number,font: string,halo: number)=>{
    ctx.font=font;ctx.lineJoin='round';ctx.strokeStyle=palette.arena;ctx.lineWidth=halo;ctx.strokeText(text,480,y);
    ctx.fillStyle=palette.text;ctx.fillText(text,480,y);
  };
  ctx.textAlign = 'center';
  const intro=game.round.intro;
  if (paused) banner('PAUSE',155,'bold 34px Arial',7);
  else if (intro && (intro.step==='ready' || intro.step==='fight')) {
    // Round intro: a short pop-in, then the text fades out over the last frames of its step.
    const total=intro.step==='ready'?INTRO_READY_FRAMES:INTRO_FIGHT_FRAMES,time=intro.frame+alpha;
    const pop=Math.min(1,time/6),size=Math.round((intro.step==='ready'?40:52)*(1.25-.25*pop));
    ctx.save();ctx.globalAlpha=Math.max(0,Math.min(pop,(total-time)/10));
    banner(t(intro.step==='ready'?'banner.readyUp':'banner.fight'),165,`bold ${size}px Arial`,8);
    ctx.restore();
  }
  else if (game.round.phase === 'roundOver' || game.round.phase === 'matchOver') {
    banner(game.round.phase === 'matchOver' ? `PLAYER ${game.round.winner!+1} WINS` : game.round.reason === 'KO' ? 'K.O.' : game.round.reason!,155,'bold 34px Arial',7);
    banner(game.round.phase === 'matchOver' ? t(demo ? 'banner.nextMatch' : 'banner.restart') : game.round.winner === null ? t('banner.replayRound') : t('banner.roundTo',{player:game.round.winner+1}),181,'11px monospace',4);
  }
  ctx.textAlign = 'left';ctx.lineJoin='miter';
}

/** Sizes the canvas backing store to its on-screen size times the device pixel
 * ratio, so the 960x420 logical scene is rasterised sharply instead of being
 * stretched by CSS. The scale snaps to quarter steps and is capped for speed. */
export function fitCanvas(canvas: HTMLCanvasElement): void {
  const cssWidth=canvas.getBoundingClientRect().width;
  if(!cssWidth)return;
  const scale=Math.min(3,Math.max(1,Math.ceil(cssWidth*(window.devicePixelRatio||1)/960*4)/4));
  const width=Math.round(960*scale),height=Math.round(420*scale);
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
}
