import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONTROLS, Devices, MIN_TRIGGER_THRESHOLD, validateControls } from '../../src/platform/devices';
import { buttonBit } from '../../src/input/types';
import publicDefaults from '../../public/config/controls.json';

const listeners=new Map<string,(event:unknown)=>void>();
beforeEach(()=>{
  listeners.clear();
  vi.stubGlobal('window',{addEventListener:(name:string,callback:(event:unknown)=>void)=>listeners.set(name,callback)});
  vi.stubGlobal('localStorage',{getItem:()=>null,setItem:vi.fn()});
});
afterEach(()=>vi.unstubAllGlobals());
function key(type:string,code:string):void { listeners.get(type)?.({code,target:{matches:()=>false},preventDefault:()=>{},stopImmediatePropagation:()=>{}}); }
function pad() {
  return {id:'Test arcade controller',index:0,connected:true,mapping:'standard',timestamp:0,axes:[0,0,0,0],buttons:Array.from({length:20},()=>({value:0,pressed:false,touched:false}))};
}

it('keeps bundled fallback controls in sync with the public configuration',()=>{
  expect(publicDefaults).toEqual(DEFAULT_CONTROLS);
});

describe('browser device adapters',()=>{
  it('retains a quick key tap, ignores OS repeats and clears held keys on blur',()=>{
    const devices=new Devices();
    key('keydown','KeyR');key('keyup','KeyR');
    expect(devices.sample([])[0].taps).toBe(1);expect(devices.sample([])[0].taps).toBe(0);
    key('keydown','KeyR');devices.sample([]);key('keydown','KeyR');
    const held=devices.sample([])[0];expect(held.buttons).toBe(1);expect(held.taps).toBe(0);
    key('keydown','KeyD');listeners.get('blur')?.({});
    expect(devices.sample([])[0]).toEqual({left:false,right:false,up:false,down:false,buttons:0,taps:0});
  });
  it('retains short direction taps and preserves physical numpad codes',()=>{
    const devices=new Devices();key('keydown','KeyS');key('keyup','KeyS');key('keydown','Numpad9');
    const input=devices.sample([]);expect(input[0].down).toBe(true);expect(input[1].buttons).toBe(buttonBit('HP'));
  });
  it('maps the six-button pad layout and applies stick hysteresis and trigger thresholds',()=>{
    const devices=new Devices();devices.config.players[0].gamepadIndex=0;const p=pad();
    p.axes[0]=0.4;expect(devices.sample([p])[0].right).toBe(true);
    p.axes[0]=0.3;expect(devices.sample([p])[0].right).toBe(true);
    p.axes[0]=0.2;expect(devices.sample([p])[0].right).toBe(false);
    p.buttons[2].value=1;p.buttons[5].value=1;p.buttons[7].value=0.49;
    expect(devices.sample([p])[0].buttons).toBe(buttonBit('LP')|buttonBit('HP'));
    p.buttons[7].value=0.51;expect(devices.sample([p])[0].buttons).toBe(buttonBit('LP')|buttonBit('HP')|buttonBit('HK'));
    expect(devices.sample([p])[1].buttons).toBe(0);
  });
  it('supports custom buttons, d-pad directions and axes',()=>{
    const devices=new Devices();const profile=devices.config.players[1];profile.gamepadIndex=0;profile.padButtons.LP=10;profile.padDirections.up=11;profile.axes={horizontal:2,vertical:3};
    const p=pad();p.buttons[10].value=1;p.buttons[11].value=1;p.axes[2]=-0.8;
    const input=devices.sample([p])[1];expect(input.buttons).toBe(1);expect(input.up).toBe(true);expect(input.left).toBe(true);
    expect(devices.sample([null])[1].buttons).toBe(0);
  });
  it('rejects a trigger threshold of 0 and never reads resting or missing buttons as pressed',()=>{
    expect(()=>validateControls({...structuredClone(DEFAULT_CONTROLS),triggerThreshold:0})).toThrow(/Trigger/);
    expect(validateControls({...structuredClone(DEFAULT_CONTROLS),triggerThreshold:MIN_TRIGGER_THRESHOLD}).triggerThreshold).toBe(MIN_TRIGGER_THRESHOLD);
    const devices=new Devices();devices.config.players[0].gamepadIndex=0;
    devices.config.triggerThreshold=0; // bypasses validation, e.g. an outdated in-memory config
    const p=pad();p.buttons.length=2; // mapped buttons and d-pad indexes beyond the pad
    expect(devices.sample([p])[0]).toEqual({left:false,right:false,up:false,down:false,buttons:0,taps:0});
    p.buttons[0].value=0.01;
    expect(devices.sample([p])[0].buttons).toBe(0);
  });
});

describe('atomic control changes',()=>{
  it('keeps a valid change active for the session when storage fails',()=>{
    const setItem=vi.fn(()=>{throw Error('QuotaExceededError');});
    vi.stubGlobal('localStorage',{getItem:()=>null,setItem});
    const devices=new Devices();key('keydown','KeyR');
    const next=structuredClone(devices.config);next.bufferFrames=9;
    expect(devices.apply(next)).toEqual({saved:false});
    expect(devices.config.bufferFrames).toBe(9);expect(setItem).toHaveBeenCalledOnce();
    expect(devices.sample([])[0].buttons).toBe(0); // held keys were cleared with the change
  });
  it('reports a stored change and leaves the active config untouched on an invalid draft',()=>{
    const devices=new Devices();const before=structuredClone(devices.config);
    const next=structuredClone(devices.config);next.bufferFrames=12;
    expect(devices.apply(next)).toEqual({saved:true});
    const invalid=structuredClone(devices.config);invalid.bufferFrames=0;
    expect(()=>devices.apply(invalid)).toThrow();
    expect(devices.config).toEqual({...before,bufferFrames:12});
  });
});
