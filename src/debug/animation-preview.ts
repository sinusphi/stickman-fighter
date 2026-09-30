import { FIGURE_SCALE } from '../data/figure-scale';
import { advanceOffset, animations, animationTrails, isKneeTrail, sampleAngles, samplePose, sampleTrails, sampleRotationTrail, sampleTurn, sampleYaw, MIRROR_YAW_ANIMATIONS } from '../render/skeleton';
import { drawFigure, drawTrail } from '../render/figure';
import { sampleDepths } from '../render/depth';
import { facePoint } from '../render/facing';
import type { Palette } from '../platform/theme';
import { onLanguageChange, t } from '../platform/i18n';
import { drawKneeSwoosh } from '../render/impact';

const tx=(key: Parameters<typeof t>[0])=>`data-i18n="${key}">${t(key)}`;
const previewKeys: Record<string, Parameters<typeof t>[0]> = {
  DemoBodyCW:'preview.wholeCw', DemoBodyCCW:'preview.wholeCcw',
  DemoLegsCW:'preview.legsCw', DemoLegsCCW:'preview.legsCcw',
  Idle:'preview.idle', Crouch:'preview.crouch', JumpSquat:'preview.jumpSquat',
  Airborne:'preview.airborne', Blockstun:'preview.block', CrouchBlock:'preview.crouchBlock',
  Hitstun:'preview.hitstun', Knockdown:'preview.knockdown',
  Walk:'preview.walk', WalkBackward:'preview.walkBack', CrouchWalk:'preview.crouchWalk',
  HitMiddlePunch:'preview.hitPunch', HitLOW:'preview.hitLow', HitMID:'preview.hitMid',
  HitHIGH:'preview.hitHigh', Landing:'preview.landing', KO:'preview.ko',
};
const specialLabels: Record<string, string> = {
  spin_mk:'Spin Middle Kick · 4+MK', spin_hk:'Spin High Kick · 6+HK',
  jumping_uppercut:'Jumping Uppercut · 6+HP', tornado_mk:'Tornado · 6+MK',
  forward_spin_hk:'Spin · 4+HK', tornado_spin_combo:'Tornado → Spin · 6+MK+HK',
};
function animationLabel(id: string): string {
  if(previewKeys[id])return t(previewKeys[id]);
  if(specialLabels[id]) {
    const side=id==='forward_spin_hk'?'left':['jumping_uppercut','tornado_mk'].includes(id)?'right':null;
    return specialLabels[id]+(side?` (${t(`preview.${side}`)})`:'');
  }
  const match=/^(standing|crouching|airborne)_(lp|mp|hp|lk|lmk|hk|rlk|mk|rhk)$/.exec(id);
  if(match) {
    const [,stance,button]=match;
    return `${t(`preview.${stance}` as Parameters<typeof t>[0])} · ${t(`action.${button.toUpperCase()}` as Parameters<typeof t>[0])} · ${button.toUpperCase()}`;
  }
  return id;
}
// Derive the inventory from the renderer so new clips cannot silently disappear.
const previewAnimationIds = [
  ...Object.keys(animations).filter(id=>id.startsWith('Demo')),
  ...Object.keys(animations).filter(id=>!id.startsWith('Demo')),
];
export const previewMarkup = `
<details id="animation-preview">
  <summary ${tx('preview.summary')}</summary>
  <p class="hint" ${tx('preview.help')}</p>
  <div class="preview-controls">
    <label><span ${tx('preview.animation')}</span> <select id="preview-animation">
      ${previewAnimationIds.map(id=>`<option value="${id}">${animationLabel(id)}</option>`).join('')}
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
    drawFigure(ctx,pose,palette.p1,palette,facing,0,sampleDepths(id,time),sampleTurn(id,time),sampleYaw(id,time),animations[id].fixedLegDepth,MIRROR_YAW_ANIMATIONS.has(id));
    drawKneeSwoosh(ctx,id,time,facing,palette.p1,palette);
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
