import { FIGURE_SCALE } from '../data/figure-scale';
import { animations, animationTrails, sampleAngles, samplePose, sampleTrails, sampleRotationTrail, sampleTurn, sampleYaw } from '../render/skeleton';
import { drawFigure, drawTrail } from '../render/figure';
import { sampleDepths } from '../render/depth';
import { facePoint } from '../render/facing';
import type { Palette } from '../platform/theme';
import { t } from '../platform/i18n';

const tx=(key: Parameters<typeof t>[0])=>`data-i18n="${key}">${t(key)}`;
export const previewMarkup = `
<details id="animation-preview">
  <summary ${tx('preview.summary')}</summary>
  <p class="hint" ${tx('preview.help')}</p>
  <div class="preview-controls">
    <label><span ${tx('preview.animation')}</span> <select id="preview-animation">
      <option value="DemoBodyCW" ${tx('preview.wholeCw')}</option><option value="DemoBodyCCW" ${tx('preview.wholeCcw')}</option>
      <option value="DemoLegsCW" ${tx('preview.legsCw')}</option><option value="DemoLegsCCW" ${tx('preview.legsCcw')}</option>
      <option value="spin_mk">Spin Middle Kick · 4+MK</option><option value="spin_hk">Spin High Kick · 6+HK</option>
      <option value="jumping_uppercut" data-preview-label="Jumping Uppercut · 6+HP" data-side="right">Jumping Uppercut · 6+HP (${t('preview.right')})</option><option value="tornado_mk" data-preview-label="Tornado · 6+MK" data-side="right">Tornado · 6+MK (${t('preview.right')})</option><option value="forward_spin_hk" data-preview-label="Spin · 4+HK" data-side="left">Spin · 4+HK (${t('preview.left')})</option><option value="tornado_spin_combo">Tornado → Spin · 6+MK+HK</option>
      ${['standing','crouching','airborne'].map(stance=>['lk','lmk','hk','rlk','mk','rhk'].map((kick,i)=>`<option value="${stance}_${kick}" data-stance="${stance}" data-side="${i<3?'left':'right'}" data-level="${['Low','Middle','High'][i%3]}">${t(`preview.${stance}` as Parameters<typeof t>[0])} · ${t(`preview.${i<3?'left':'right'}`)} · ${['Low','Middle','High'][i%3]}</option>`).join('')).join('')}
      ${['standing','crouching','airborne'].map(stance=>`<option value="${stance}_mp" data-stance="${stance}" data-side="left" data-punch="true">${t(`preview.${stance}` as Parameters<typeof t>[0])} · Middle punch ${t('preview.left')}</option>`).join('')}
      <option value="HitMiddlePunch" ${tx('preview.hitPunch')}</option>
      <option value="Walk" ${tx('preview.walk')}</option><option value="WalkBackward" ${tx('preview.walkBack')}</option><option value="CrouchWalk" ${tx('preview.crouchWalk')}</option>
      <option value="HitLOW" ${tx('preview.hitLow')}</option><option value="HitMID" ${tx('preview.hitMid')}</option><option value="HitHIGH" ${tx('preview.hitHigh')}</option>
      <option value="Landing" ${tx('preview.landing')}</option><option value="KO" ${tx('preview.ko')}</option>
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
  const sync=()=>{range.value=String(time);play.textContent=t(playing?'preview.stop':'preview.play');
    select.querySelectorAll<HTMLOptionElement>('[data-stance]').forEach(option=>{option.textContent=`${t(`preview.${option.dataset.stance}` as Parameters<typeof t>[0])} · ${option.dataset.punch?'Middle punch ':''}${t(`preview.${option.dataset.side}` as Parameters<typeof t>[0])}${option.dataset.level?` · ${option.dataset.level}`:''}`;});
    select.querySelectorAll<HTMLOptionElement>('[data-preview-label]').forEach(option=>{option.textContent=`${option.dataset.previewLabel} (${t(`preview.${option.dataset.side}` as Parameters<typeof t>[0])})`;});};
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
    const trails=animationTrails(id),samples=sampleTrails(id,time);
    trails.forEach((trail,index)=>{
      const fade=Math.min(1,Math.max(0,(trail.toFrame+trail.historyFrames-time)/trail.historyFrames));
      drawTrail(ctx,samples[index],palette.p1,fade,trail.directional??true,facing,trail.directional?palette.revenge:palette.special);
    });
    drawTrail(ctx,sampleRotationTrail(id,time),palette.revenge,.72,true,facing,palette.special);
    drawFigure(ctx,pose,palette.p1,palette,facing,0,sampleDepths(id,time),sampleTurn(id,time),sampleYaw(id,time),animations[id].fixedLegDepth);
    for(const trail of trails)if(time>=trail.fromFrame && time<=trail.toFrame) {
      const anchor=facePoint(pose[trail.joint],facing);ctx.fillStyle=trail.directional?palette.special:palette.p1;ctx.beginPath();ctx.arc(anchor[0],anchor[1],4.2,0,Math.PI*2);ctx.fill();
    }
    if(id.startsWith('Demo')) {
      ctx.strokeStyle=palette.muted;ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(-5,0);ctx.lineTo(5,0);ctx.moveTo(0,-5);ctx.lineTo(0,5);ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle=palette.muted;ctx.font='14px monospace';ctx.fillText(t(id.startsWith('Demo')?'preview.demoLegend':'preview.motionLegend'),20,28);
  };
}
