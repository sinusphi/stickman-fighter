import { expect, it } from 'vitest';
import css from '../../src/themes.css?raw';
import uiStyle from '../../src/style.css?raw';
import canvasSource from '../../src/render/canvas.ts?raw';
import stageSource from '../../src/render/stages.ts?raw';
const palettes=[...css.matchAll(/\{([^}]+)\}/g)].map(match=>Object.fromEntries([...match[1].matchAll(/--([\w-]+):\s*(#[\da-f]{6}|[\d.]+)/g)].map(m=>[m[1],m[2]])));
function luminance(color:string):number {
  const channels=color.slice(1).match(/../g)!.map(hex=>parseInt(hex,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
}
function ratio(a:string,b:string):number { const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); }
function composite(a:string,b:string,alpha:number):string {
  const values=(c:string)=>c.slice(1).match(/../g)!.map(v=>parseInt(v,16));const bg=values(b);
  return '#'+values(a).map((v,i)=>Math.round(v*alpha+bg[i]*(1-alpha)).toString(16).padStart(2,'0')).join('');
}
it.each([0,1])('theme %s meets contrast for text, state colors, canvas and meters',index=>{
  const p=palettes[index];
  for(const bg of ['page','arena','hover','key']) for(const text of ['text','muted'])expect(ratio(p[text],p[bg]),`${text}/${bg}`).toBeGreaterThanOrEqual(4.5);
  expect(ratio(p.inverse,p.primary)).toBeGreaterThanOrEqual(4.5);
  for(const player of ['p1','p2'])expect(ratio(p[player],p.arena),'player/arena').toBeGreaterThanOrEqual(3);
  expect(ratio(p.rigOutline,p.arena),'figure outline/arena').toBeGreaterThanOrEqual(3);
  expect(ratio(p['disabled-text'],p['disabled-bg'])).toBeGreaterThanOrEqual(3);
  for(const fg of ['p1','p2','revenge','special','line']) for(const bg of ['arena','track'])expect(ratio(p[fg],p[bg]),`${fg}/${bg}`).toBeGreaterThanOrEqual(3);
  for(const fg of ['hurt','push','hit']) {
    expect(ratio(p[fg],p.arena),fg).toBeGreaterThanOrEqual(4.5);
    // Debug outline against its translucent interior, including overlapping boxes.
    let bg=p.arena;
    for(const box of ['hurt','push','hit'])bg=composite(p[box],bg,Number(p['box-alpha']));
    expect(ratio(p[fg],bg),`${fg}/composite`).toBeGreaterThanOrEqual(3);
  }
  for(const bg of ['page','hover','key'])expect(ratio(p.focus,p[bg])).toBeGreaterThanOrEqual(3);
});
it('keeps color literals out of UI styles and Canvas',()=>{
  for(const source of [uiStyle,canvasSource,stageSource])expect(source).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(/i);
});

it('intensifies the existing player hues and preserves resource colors',()=>{
  const old=[{p1:'#275cbe',p2:'#bc363e',revenge:'#7836a5',special:'#14868b'},{p1:'#75a7ff',p2:'#ff8189',revenge:'#c996ff',special:'#85eee5'}];
  const hsv=(color:string)=>{
    const [r,g,b]=color.slice(1).match(/../g)!.map(c=>parseInt(c,16)/255),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
    const hue=(max===r?(g-b)/d:max===g?(b-r)/d+2:(r-g)/d+4)*60;
    return {hue:(hue+360)%360,saturation:d/max};
  };
  palettes.forEach((p,i)=>{
    for(const name of ['p1','p2'] as const) {
      const before=hsv(old[i][name]),after=hsv(p[name]);
      expect(Math.abs(before.hue-after.hue)).toBeLessThan(i===0?.5:10);
      expect(after.saturation).toBeGreaterThan(before.saturation+.1);
    }
    expect(p.revenge).toBe(old[i].revenge);expect(p.special).toBe(old[i].special);
  });
});

it('keeps Light player colors unchanged and makes Dark substantially more saturated than Update 07',()=>{
  expect(palettes[0].p1).toBe('#134fbe');expect(palettes[0].p2).toBe('#bc1720');
  const saturation=(hex:string)=>{
    const rgb=hex.slice(1).match(/../g)!.map(v=>parseInt(v,16));
    return 1-Math.min(...rgb)/Math.max(...rgb);
  };
  for(const [key,old] of [['p1','#4d8dff'],['p2','#ff5964']])
    expect(saturation(palettes[1][key])-saturation(old)).toBeGreaterThan(.15);
});
