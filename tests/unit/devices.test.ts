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

describe('throw button (controls schema 3)',()=>{
  /** A stored v2 configuration as earlier versions saved it: no THROW anywhere. */
  function v2() {
    const old=structuredClone(DEFAULT_CONTROLS);old.schemaVersion=2;
    for(const player of old.players) {
      delete (player.keys as Partial<typeof player.keys>).THROW;
      delete (player.padButtons as Partial<typeof player.padButtons>).THROW;
    }
    return old;
  }
  it('binds C (P1), Numpad0 (P2) and LB (button 4) by default',()=>{
    expect(DEFAULT_CONTROLS.schemaVersion).toBe(3);
    expect(DEFAULT_CONTROLS.players.map(p=>p.keys.THROW)).toEqual(['KeyC','Numpad0']);
    expect(DEFAULT_CONTROLS.players.map(p=>p.padButtons.THROW)).toEqual([4,4]);
    for(const player of DEFAULT_CONTROLS.players)expect(new Set(Object.values(player.keys)).size).toBe(Object.keys(player.keys).length);
  });
  it('migrates stored v2 bindings: adds THROW, keeps every custom binding',()=>{
    const old=v2();old.players[0].keys.LP='KeyQ';old.players[1].padButtons.HK=9;old.players[0].autoBlock=true;
    const migrated=validateControls(old);
    expect(migrated.schemaVersion).toBe(3);expect(old.schemaVersion).toBe(2);
    expect(migrated.players.map(p=>p.keys.THROW)).toEqual(['KeyC','Numpad0']);
    expect(migrated.players.map(p=>p.padButtons.THROW)).toEqual([4,4]);
    expect(migrated.players[0].keys.LP).toBe('KeyQ');expect(migrated.players[1].padButtons.HK).toBe(9);expect(migrated.players[0].autoBlock).toBe(true);
    const { THROW: _t0, ...keys0 }=migrated.players[0].keys;const { THROW: _t1, ...pads1 }=migrated.players[1].padButtons;
    expect(keys0).toEqual(old.players[0].keys);expect(pads1).toEqual(old.players[1].padButtons);
  });
  it('picks the first free key when the default is already taken, also across players',()=>{
    const old=v2();old.players[0].keys.LP='KeyC';old.players[1].keys.HP='KeyX';
    const migrated=validateControls(old);
    expect(migrated.players[0].keys.THROW).toBe('KeyZ');
    expect(migrated.players[1].keys.THROW).toBe('Numpad0');
    for(const player of migrated.players)expect(new Set(Object.values(player.keys)).size).toBe(14);
  });
  it('loads a stored v2 configuration instead of discarding it',()=>{
    const old=v2();old.players[0].keys.LP='KeyQ';
    vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify(old),setItem:vi.fn()});
    const devices=new Devices();
    expect(devices.config.players[0].keys.LP).toBe('KeyQ');
    expect(devices.config.players[0].keys.THROW).toBe('KeyC');
    key('keydown','KeyC');
    expect(devices.sample([])[0].buttons).toBe(buttonBit('THROW'));
    key('keyup','KeyC');key('keydown','Numpad0');
    expect(devices.sample([])[1].buttons).toBe(buttonBit('THROW'));
  });
  it('requires THROW in a v3 configuration and reads the throw pad button',()=>{
    const broken=structuredClone(DEFAULT_CONTROLS);delete (broken.players[1].keys as Partial<typeof broken.players[1]['keys']>).THROW;
    expect(()=>validateControls(broken)).toThrow(/Tastaturbelegung/);
    const devices=new Devices();devices.config.players[0].gamepadIndex=0;
    const reading=pad();reading.buttons[4]={value:1,pressed:true,touched:true};
    expect(devices.sample([reading])[0].buttons).toBe(buttonBit('THROW'));
  });
});
