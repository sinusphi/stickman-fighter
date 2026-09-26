import { FIGURE_SCALE } from '../data/figure-scale';
import { animations, animationTrails, sampleAngles, samplePose, sampleTrails, sampleRotationTrail, sampleTurn, sampleYaw } from '../render/skeleton';
import { drawFigure, drawTrail } from '../render/figure';
import { sampleDepths } from '../render/depth';
import { facePoint } from '../render/facing';
import type { Palette } from '../platform/theme';

export const previewMarkup = `
<details id="animation-preview">
  <summary>Animationsvorschau · 2D-Rotation</summary>
  <p class="hint">Isolierte Testanimation ohne Kampf-Funktion. Weiche Spuren zeigen Schwungbahnen; violett-türkise Bögen und Pfeile zeigen die Drehrichtung.</p>
  <div class="preview-controls">
    <label>Animation <select id="preview-animation">
      <option value="DemoBodyCW">Ganzkörper ↻</option><option value="DemoBodyCCW">Ganzkörper ↺</option>
      <option value="DemoLegsCW">Beine ab Hüfte ↻</option><option value="DemoLegsCCW">Beine ab Hüfte ↺</option>
      <option value="spin_mk">Spin Middle Kick · 4+MK</option><option value="spin_hk">Spin High Kick · 6+HK</option>
      <option value="jumping_uppercut">Jumping Uppercut · 6+HP (rechts)</option><option value="tornado_mk">Tornado · 6+MK (rechts)</option><option value="forward_spin_hk">Spin · 4+HK (links)</option><option value="tornado_spin_combo">Tornado → Spin · 6+MK+HK</option>
      ${['standing','crouching','airborne'].map(stance=>['lk','lmk','hk','rlk','mk','rhk'].map((kick,i)=>`<option value="${stance}_${kick}">${stance==='standing'?'Stand':stance==='crouching'?'Hocke':'Luft'} · ${i<3?'links':'rechts'} · ${['Low','Middle','High'][i%3]}</option>`).join('')).join('')}
      ${['standing','crouching','airborne'].map(stance=>`<option value="${stance}_mp">${stance==='standing'?'Stand':stance==='crouching'?'Hocke':'Luft'} · Middlepunch links</option>`).join('')}
      <option value="HitMiddlePunch">Treffer: Middlepunch · Einknicken</option>
      <option value="Walk">Vorwärtslaufen</option><option value="WalkBackward">Rückwärtslaufen</option><option value="CrouchWalk">Hocke vorwärts</option>
      <option value="HitLOW">Treffer: Low</option><option value="HitMID">Treffer: Mid</option><option value="HitHIGH">Treffer: High</option>
      <option value="Landing">Landung</option><option value="KO">K.-o. · Fallen und Liegen</option>
    </select></label>
    <label>Tempo <select id="preview-speed"><option value="0.25">¼×</option><option value="0.5" selected>½×</option><option value="1">1×</option></select></label>
    <button id="preview-play" type="button">Abspielen</button><button id="preview-step" type="button">Frame +</button>
    <button id="preview-reset" type="button">Anfang</button><button id="preview-mirror" type="button" aria-pressed="false">Spiegeln</button>
  </div>
  <label class="preview-timeline">Zeitpunkt <input id="preview-time" type="range" min="0" max="105" step="0.25" value="0"></label>
  <output id="preview-status" for="preview-time preview-animation preview-mirror"></output>
  <canvas id="preview-canvas" width="960" height="360" aria-label="Vorschau der gewählten 2D-Animation"></canvas>
</details>`;

export function setupAnimationPreview(pauseGame: ()=>void): (time: number, palette: Palette)=>void {
  const el=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
  const panel=el<HTMLDetailsElement>('animation-preview'),select=el<HTMLSelectElement>('preview-animation');
  const range=el<HTMLInputElement>('preview-time'),speed=el<HTMLSelectElement>('preview-speed');
  const play=el<HTMLButtonElement>('preview-play'),mirror=el<HTMLButtonElement>('preview-mirror');
  const canvas=el<HTMLCanvasElement>('preview-canvas'),status=el<HTMLOutputElement>('preview-status');
  let time=0,playing=false,facing=1,lastTime:number|null=null;
  const sync=()=>{range.value=String(time);play.textContent=playing?'Anhalten':'Abspielen';};
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
    const direction=angle===0?'Startpose':angle>0?'↻ im Uhrzeigersinn':'↺ gegen den Uhrzeigersinn';
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
    ctx.fillStyle=palette.muted;ctx.font='14px monospace';ctx.fillText(id.startsWith('Demo')?'Kreuz: Hüftpivot · Akzent: linker Fuß':'Längenkonstante Gelenkbewegung',20,28);
  };
}
