import { afterEach, expect, it, vi } from 'vitest';
import css from '../../src/themes.css?raw';
import stageSource from '../../src/render/stages.ts?raw';
import { DEFAULT_STAGE, STAGES, STAGE_IDS, STAGE_VIEW, drawStage, drawContactShadow, isStageId, stagePan } from '../../src/render/stages';
import { PALETTE_KEYS, type Palette } from '../../src/platform/theme';
import { STAGE_STORAGE_KEY, loadStage } from '../../src/platform/stage';

const blocks=[...css.matchAll(/\{([^}]+)\}/g)].map(match=>Object.fromEntries([...match[1].matchAll(/--([\w-]+):\s*(#[\da-f]{6}|[\d.]+)/g)].map(m=>[m[1],m[2]])));
const palettes=blocks.slice(0,2).map(tokens=>({...Object.fromEntries(PALETTE_KEYS.map(key=>[key,tokens[key]])),boxAlpha:Number(tokens['box-alpha'])}) as Palette);

/** Minimal recording 2D context: enough to run every stage headlessly. */
function recorder() {
  const log: string[]=[],colors: string[]=[];let depth=0,alpha=1;
  const gradient=()=>({addColorStop:(offset: number,color: string)=>{colors.push(color);log.push(`stop ${offset} ${color}`);}});
  const target: Record<string, unknown>={
    save:()=>{depth++;log.push('save');}, restore:()=>{depth--;log.push('restore');},
    createLinearGradient:gradient, createRadialGradient:gradient,
  };
  const ctx=new Proxy(target,{
    get:(t,key: string)=>key==='globalAlpha'?alpha:key in t?t[key]:(...args: unknown[])=>{log.push(`${key} ${args.map(a=>typeof a==='number'?a.toFixed(2):String(a)).join(',')}`);},
    set:(t,key: string,value)=>{if(key==='globalAlpha')alpha=value;if((key==='fillStyle'||key==='strokeStyle')&&typeof value==='string')colors.push(value);log.push(`${key}=${String(value)}`);t[key]=value;return true;},
  }) as unknown as CanvasRenderingContext2D;
  return {ctx,log,colors,depth:()=>depth,alpha:()=>alpha};
}

afterEach(()=>vi.unstubAllGlobals());

it('offers exactly three named stages with captions and a valid default',()=>{
  expect(STAGE_IDS).toHaveLength(3);
  expect(new Set(STAGE_IDS.map(id=>STAGES[id].caption)).size).toBe(3);
  expect(STAGES[DEFAULT_STAGE].caption).toBe('THE DOJO');
  expect(STAGE_IDS.every(isStageId)).toBe(true);
  for(const value of ['', 'DOJO', null, undefined, 3, 'arena'])expect(isStageId(value)).toBe(false);
});

it('defines every palette token, including stage colours, in both themes',()=>{
  for(const palette of palettes)for(const key of PALETTE_KEYS)expect(palette[key],key).toMatch(/^#[\da-f]{6}$/);
});

it.each(STAGE_IDS.flatMap(stage=>[0,1].map(theme=>[stage,theme] as const)))('paints %s (theme %s) with palette colours only and balanced canvas state',(stage,theme)=>{
  const r=recorder();
  drawStage(r.ctx,stage,palettes[theme],stagePan(300));
  expect(r.depth()).toBe(0);expect(r.alpha()).toBe(1);
  expect(r.colors.length).toBeGreaterThan(20);
  // Stage colours are palette hex values, optionally with an alpha suffix for gradients.
  for(const color of r.colors)expect(color).toMatch(/^#[\da-f]{6}([\da-f]{2})?$/);
  expect(r.log.join('\n')).not.toMatch(/undefined|NaN|Infinity/);
});

it('is deterministic and follows the fighters with a bounded, centred parallax',()=>{
  const paint=(pan: number)=>{const r=recorder();drawStage(r.ctx,'rooftop',palettes[0],pan);return r.log.join('\n');};
  expect(paint(stagePan(250))).toBe(paint(stagePan(250)));
  expect(paint(stagePan(250))).not.toBe(paint(stagePan(710)));
  expect(stagePan(STAGE_VIEW.width/2)).toBe(0);
  expect(stagePan(100)).toBeCloseTo(-stagePan(860),10);
  expect(Math.abs(stagePan(0))).toBeLessThanOrEqual(40);
});

it('keeps stages presentational: no simulation imports and no colour literals',()=>{
  expect(stageSource).not.toMatch(/from '\.\.\/(simulation|input|ai|debug)\//);
  expect(stageSource).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(/i);
  expect(stageSource).not.toMatch(/Math\.random/);
});

it('draws a contact shadow that fades and narrows while airborne',()=>{
  const shadow=(lift: number)=>{const r=recorder();drawContactShadow(r.ctx,480,20,lift,palettes[0]);
    const ellipse=r.log.find(line=>line.startsWith('ellipse'))!.split(' ')[1].split(',').map(Number);
    return {alpha:Number(r.log.find(line=>line.startsWith('globalAlpha='))!.split('=')[1]),radius:ellipse[2]};};
  expect(shadow(80).alpha).toBeLessThan(shadow(0).alpha);expect(shadow(80).radius).toBeLessThan(shadow(0).radius);
  expect(shadow(-5)).toEqual(shadow(0));
});

it('restores the stored stage and falls back to the default for missing, invalid or blocked storage',()=>{
  const store=new Map<string,string>();
  vi.stubGlobal('localStorage',{getItem:(key: string)=>store.get(key)??null,setItem:(key: string,value: string)=>{store.set(key,value);}});
  expect(loadStage()).toBe(DEFAULT_STAGE);
  store.set(STAGE_STORAGE_KEY,'shrine');expect(loadStage()).toBe('shrine');
  store.set(STAGE_STORAGE_KEY,'moon');expect(loadStage()).toBe(DEFAULT_STAGE);
  vi.stubGlobal('localStorage',{getItem:()=>{throw Error('denied');}});
  expect(loadStage()).toBe(DEFAULT_STAGE);
});

it('keeps 3:1 contrast between both fighters and every stage surface behind them',()=>{
  const lum=(hex: string)=>{const [r,g,b]=hex.slice(1).match(/../g)!.map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*r+.7152*g+.0722*b;};
  const ratio=(a: string,b: string)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  // Surfaces that can appear in the fighters' standing band; sky and lamp colours stay above it.
  const surfaces=PALETTE_KEYS.filter(key=>/^(dojo|roof|shrine)/.test(key)&&!['roofSky','shrineSky','shrineMoon','dojoLamp','dojoCeiling'].includes(key));
  expect(surfaces).toHaveLength(20);
  for(const palette of palettes)for(const key of surfaces)for(const player of ['p1','p2'] as const)
    expect(ratio(palette[key],palette[player]),`${key}/${player}`).toBeGreaterThanOrEqual(3);
});
