import { FIGURE_SCALE } from '../data/figure-scale';
import { buildPose, advanceOffset, animations, animationTrails, isKneeTrail, sampleAngles, samplePose, sampleTrails, sampleRotationTrail, sampleTurn, sampleHeadYaw, MIRROR_YAW_ANIMATIONS } from '../render/skeleton';
import { drawFigure, drawTrail } from '../render/figure';
import { sampleDepths } from '../render/depth';
import { facePoint } from '../render/facing';
import type { Palette } from '../platform/theme';
import { onLanguageChange, t } from '../platform/i18n';
import { drawKneeSwoosh } from '../render/impact';
import { comboLabel, comboMoves } from '../platform/combos';
import { MOVES, type CompiledMove } from '../data/schema';

const tx=(key: Parameters<typeof t>[0])=>`data-i18n="${key}">${t(key)}`;
const previewKeys: Record<string, Parameters<typeof t>[0]> = {
  DemoBodyCW:'preview.wholeCw', DemoBodyCCW:'preview.wholeCcw',
  DemoLegsCW:'preview.legsCw', DemoLegsCCW:'preview.legsCcw',
  Idle:'preview.idle', Crouch:'preview.crouch', JumpSquat:'preview.jumpSquat',
  Airborne:'preview.airborne', Blockstun:'preview.block', CrouchBlock:'preview.crouchBlock',
  Hitstun:'preview.hitstun', Knockdown:'preview.knockdown',
  Walk:'preview.walk', Run:'preview.run', WalkBackward:'preview.walkBack', CrouchWalk:'preview.crouchWalk',
  HitMiddlePunch:'preview.hitPunch', HitLOW:'preview.hitLow', HitMID:'preview.hitMid',
  HitHIGH:'preview.hitHigh', Landing:'preview.landing', KO:'preview.ko',
};
/** Display names of the single-button hold specials; inputs come from the move data. */
const specialNames: Record<string, string> = {
  spin_mk:'Spin Middle Kick', spin_hk:'Spin High Kick', jumping_uppercut:'Jumping Uppercut',
  tornado_mk:'Tornado', forward_spin_hk:'Spin', dwit_chagi:'Dwit Chagi', left_turn_kick:'Left Turn Kick',
};
const specialSides: Record<string, 'left' | 'right'> = { forward_spin_hk:'left', jumping_uppercut:'right', tornado_mk:'right' };
const specialMoves = Object.values(MOVES).filter(move=>move.command.type==='hold' && move.command.buttons.length===1 && !move.throw);
/** Throw clips: attempts, executions with their thrown fighter, and the clash. */
const throwClips = Object.values(MOVES).filter(move=>move.throw).flatMap(move=>[move.animation,...(move.throw?.victimAnimation?[move.throw.victimAnimation]:[])]);
function throwLabel(id: string): string | undefined {
  const base=Object.values(MOVES).find(move=>move.throw && (move.animation===id || move.throw.victimAnimation===id));
  if(!base?.throw)return undefined;
  if(base.throw.phase==='break')return t('throw.break');
  const name=t(base.command.directions[0]===6?'throw.forward':'throw.back');
  const role=base.throw.phase==='attempt'?'preview.throwAttempt':base.throw.victimAnimation===id?'preview.throwVictim':'preview.throwExecute';
  return `${name} · ${t(role)} · ${base.command.directions[0]}+THROW`;
}
const commandText = (command: CompiledMove['command']) => `${command.directions.join('/')}+${command.buttons.join('+')}`;
function animationLabel(id: string): string {
  if(previewKeys[id])return t(previewKeys[id]);
  const thrown=throwLabel(id);
  if(thrown)return thrown;
  const combo=comboMoves.find(move=>move.animation===id);
  if(combo)return `${comboLabel(combo.id)} · ${commandText(combo.command as CompiledMove['command'])}`;
  const special=specialMoves.find(move=>move.animation===id);
  if(special) {
    const side=specialSides[special.id];
    return `${specialNames[special.id]??special.id} · ${commandText(special.command)}${side?` (${t(`preview.${side}`)})`:''}`;
  }
  const match=/^(standing|crouching|airborne)_(lp|mp|hp|lk|lmk|hk|rlk|mk|rhk)$/.exec(id);
  if(match) {
    const [,stance,button]=match;
    return `${t(`preview.${stance}` as Parameters<typeof t>[0])} · ${t(`action.${button.toUpperCase()}` as Parameters<typeof t>[0])} · ${button.toUpperCase()}`;
  }
  return id;
}
// Explicit categories and button order, with a fallback for new renderer clips.
const previewButtonOrder=['lp','mp','hp','lk','lmk','hk','rlk','mk','rhk'];
const previewGroups: {key: Parameters<typeof t>[0]; ids: string[]}[] = [
  {key:'preview.groupMovement',ids:['Idle','Walk','Run','WalkBackward','Crouch','CrouchWalk','JumpSquat','Airborne','Landing']},
  ...(['standing','crouching','airborne'] as const).map(stance=>({key:`preview.${stance}` as Parameters<typeof t>[0],ids:previewButtonOrder.map(button=>`${stance}_${button}`)})),
  {key:'preview.groupSpecials',ids:[...new Set(['jumping_uppercut','left_turn_kick','dwit_chagi','spin_mk','forward_spin_hk','spin_hk','tornado_mk',...specialMoves.map(move=>move.animation)])]},
  {key:'combo.summary',ids:comboMoves.map(move=>move.animation)},
  {key:'preview.groupThrows',ids:throwClips},
  {key:'preview.groupReactions',ids:['Blockstun','CrouchBlock','Hitstun','HitMiddlePunch','HitLOW','HitMID','HitHIGH','Knockdown','KO']},
  {key:'preview.groupDemos',ids:Object.keys(animations).filter(id=>id.startsWith('Demo'))},
];
const listedIds=new Set(previewGroups.flatMap(group=>group.ids));
previewGroups.push({key:'preview.groupOther',ids:Object.keys(animations).filter(id=>!listedIds.has(id)).sort()});
export const previewMarkup = `
<details id="animation-preview">
  <summary ${tx('preview.summary')}</summary>
  <p class="hint" ${tx('preview.help')}</p>
  <div class="preview-controls">
    <label><span ${tx('preview.animation')}</span> <select id="preview-animation">
      ${previewGroups.map(group=>{
        const ids=group.ids.filter(id=>id in animations);
        return ids.length?`<optgroup data-label-key="${group.key}" label="${t(group.key)}">${ids.map(id=>`<option value="${id}">${animationLabel(id)}</option>`).join('')}</optgroup>`:'';
      }).join('')}
    </select></label>
    <label><span ${tx('preview.speed')}</span> <select id="preview-speed"><option value="0.25">¼×</option><option value="0.5" selected>½×</option><option value="1">1×</option></select></label>
    <button id="preview-play" type="button">${t('preview.play')}</button><button id="preview-step" type="button" ${tx('preview.step')}</button>
    <button id="preview-reset" type="button" ${tx('preview.reset')}</button><button id="preview-mirror" type="button" aria-pressed="false" ${tx('preview.mirror')}</button>
  </div>
  <label class="preview-timeline"><span ${tx('preview.time')}</span> <input id="preview-time" type="range" min="0" max="105" step="0.25" value="0"></label>
  <output id="preview-status" for="preview-time preview-animation preview-mirror"></output>
  <canvas id="preview-canvas" width="960" height="360" data-i18n-aria-label="preview.canvas" aria-label="${t('preview.canvas')}"></canvas>
</details>`;

export function setupAnimationPreview(pauseGame: ()=>void): (time: number, palette: Palette)=>void {
  const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
  const panel=el<HTMLDetailsElement>('animation-preview'),select=el<HTMLSelectElement>('preview-animation');
  const range=el<HTMLInputElement>('preview-time'),speed=el<HTMLSelectElement>('preview-speed');
  const play=el<HTMLButtonElement>('preview-play'),mirror=el<HTMLButtonElement>('preview-mirror');
  const canvas=el<HTMLCanvasElement>('preview-canvas'),status=el<HTMLOutputElement>('preview-status');
  let time=0,playing=false,facing=1,lastTime:number|null=null;
  const sync=()=>{
    range.value=String(time);
    const label=t(playing?'preview.stop':'preview.play');
    if(play.textContent!==label)play.textContent=label;
  };
  // Replacing option text while the native popup is open rebuilds its rows.
  // Only translate on language changes, never from the animation frame loop.
  onLanguageChange(()=>{
    for(const option of select.options)option.textContent=animationLabel(option.value);
    for(const group of select.querySelectorAll('optgroup'))group.label=t(group.dataset.labelKey as Parameters<typeof t>[0]);
    sync();
  });
  range.max=String(animations[select.value].durationFrames-1);
  sync();
  panel.addEventListener('toggle',()=>{playing=false;lastTime=null;if(panel.open)pauseGame();sync();});
  select.onchange=()=>{time=0;playing=false;range.max=String(animations[select.value].durationFrames-1);sync();};
  range.oninput=()=>{time=Number(range.value);playing=false;sync();};
  play.onclick=()=>{if(time>=Number(range.max))time=0;playing=!playing;lastTime=null;sync();};
  el<HTMLButtonElement>('preview-step').onclick=()=>{playing=false;time=Math.min(Number(range.max),Math.floor(time)+1);sync();};
  el<HTMLButtonElement>('preview-reset').onclick=()=>{time=0;playing=false;sync();};
  mirror.onclick=()=>{facing=-facing;mirror.setAttribute('aria-pressed',String(facing===-1));};
  window.addEventListener('blur',()=>{playing=false;lastTime=null;sync();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){playing=false;lastTime=null;sync();}});
  return (now,palette)=>{
    if(!panel.open){lastTime=null;return;}
    if(playing && lastTime!==null) {
      // A suspended browser must not skip through an unseen demonstration.
      const elapsed=now-lastTime;
      if(elapsed>250)playing=false;
      else time=Math.min(Number(range.max),time+Math.max(0,elapsed)*.06*Number(speed.value));
      if(time>=Number(range.max))playing=false;
    }
    lastTime=now;sync();
    const id=select.value,pose=samplePose(id,time),angle=(sampleAngles(id,time).rotations?.[0]?.angle??0)*facing;
    const direction=t(angle===0?'preview.startPose':angle>0?'preview.clockwise':'preview.counterclockwise');
    status.textContent=`Frame ${time.toFixed(2)} / ${range.max}${id.startsWith('Demo')?` · ${angle.toFixed(1)}° · ${direction}`:''}`;
    canvas.dataset.frame=time.toFixed(2);canvas.dataset.animation=id;
    const ctx=canvas.getContext('2d')!;
    ctx.clearRect(0,0,960,360);ctx.fillStyle=palette.arena;ctx.fillRect(0,0,960,360);
    ctx.save();ctx.translate(480,id.startsWith('Demo')?180:310);ctx.scale(1.65,1.65);
    ctx.scale(FIGURE_SCALE,FIGURE_SCALE);
    // Show the move's own step forward as in the game (fighter position, not pose).
    ctx.translate(advanceOffset(id,time)*facing,0);
    const trails=animationTrails(id),samples=sampleTrails(id,time);
    trails.forEach((trail,index)=>{
      if(isKneeTrail(trail))return;
      const fade=Math.min(1,Math.max(0,(trail.toFrame+trail.historyFrames-time)/trail.historyFrames));
      drawTrail(ctx,samples[index],palette.p1,fade,trail.directional??true,facing,trail.directional?palette.revenge:palette.special);
    });
    drawTrail(ctx,sampleRotationTrail(id,time),palette.revenge,.72,true,facing,palette.special);
    drawFigure(ctx,pose,palette.p1,palette,facing,0,sampleDepths(id,time),sampleTurn(id,time),sampleHeadYaw(id,time),animations[id].fixedLegDepth,MIRROR_YAW_ANIMATIONS.has(id));
    drawKneeSwoosh(ctx,id,time,facing,palette.p1,palette);
    // A throw execution shows its thrown fighter on the table position (simulation units → rig units).
    const execute=MOVES[id]?.throw?.phase==='execute'?MOVES[id].throw:undefined;
    if(execute?.path && execute.victimAnimation) {
      const last=execute.impactFrame!,at=Math.min(last,time),i=Math.floor(at),j=Math.min(last,i+1),u=at-i;
      const point=[0,1].map(k=>execute.path![i][k]+(execute.path![j][k]-execute.path![i][k])*u);
      const landed=time>last,victimId=landed?'Knockdown':execute.victimAnimation;
      // After the impact the victim lies in the knockdown pose facing the thrower again.
      const victimFacing=landed && point[0]<0?facing:-facing;
      ctx.save();ctx.translate(point[0]*facing/256/FIGURE_SCALE,point[1]/256/FIGURE_SCALE);
      const victimPose=landed?buildPose(sampleAngles('Knockdown',0),true,1,true):samplePose(victimId,at);
      drawFigure(ctx,victimPose,palette.p2,palette,victimFacing,0,sampleDepths(victimId,at));
      ctx.restore();
    }
    for(const trail of trails)if(!isKneeTrail(trail) && time>=trail.fromFrame && time<=trail.toFrame) {
      const anchor=facePoint(pose[trail.joint],facing);ctx.fillStyle=trail.directional?palette.special:palette.p1;ctx.beginPath();ctx.arc(anchor[0],anchor[1],4.2,0,Math.PI*2);ctx.fill();
    }
    if(id.startsWith('Demo')) {
      ctx.strokeStyle=palette.muted;ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(-5,0);ctx.lineTo(5,0);ctx.moveTo(0,-5);ctx.lineTo(0,5);ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle=palette.muted;ctx.font='14px monospace';ctx.fillText(t(id.startsWith('Demo')?'preview.demoLegend':'preview.motionLegend'),20,28);
  };
}
