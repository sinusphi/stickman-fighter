import defaults from '../data/default-controls.json';
import { BUTTONS, buttonBit, neutralInput, type Button, type RawInput, type SocdConfig } from '../input/types';

export type Action = 'up' | 'down' | 'left' | 'right' | Button;
export const ACTIONS: Action[] = ['up', 'left', 'down', 'right', ...BUTTONS];
export interface PlayerControls { keys: Record<Action, string>; gamepadIndex: number | null; padButtons: Record<Button, number>; padDirections: Record<'up'|'down'|'left'|'right', number>; axes: { horizontal: number; vertical: number } }
export interface Controls { schemaVersion: number; socd: SocdConfig; bufferFrames: number; deadzone: number; releaseThreshold: number; triggerThreshold: number; players: PlayerControls[] }
export interface PadReading { connected: boolean; axes: readonly number[]; buttons: readonly { value: number }[] }
export const DEFAULT_CONTROLS = defaults as Controls;

export function validateControls(value: unknown): Controls {
  const c = structuredClone(value) as Controls;
  if (!c || ![1,2].includes(c.schemaVersion) || c.players?.length !== 2) throw Error('Ungültige Konfigurationsversion oder Spielerzahl.');
  if(c.schemaVersion===1) {
    const used=new Set(c.players.flatMap(p=>Object.values(p.keys??{})));
    c.players.forEach((p,i)=>{
      if(!p.keys||!p.padButtons)throw Error('Unvollständige Belegung.');
      const oldMiddle=i===0?'KeyG':'Numpad5',newMiddle=DEFAULT_CONTROLS.players[i].keys.MK;
      if(p.keys.MK===oldMiddle&&!used.has(newMiddle)) {used.delete(oldMiddle);p.keys.MK=newMiddle;used.add(newMiddle);}
      for(const action of ['RLK','LMK','RHK'] as const) {
        const candidates=[DEFAULT_CONTROLS.players[i].keys[action],...['U','I','O','J','K','L','Z','X','C','M','Q','E'].map(k=>'Key'+k),...Array.from({length:10},(_,n)=>'Digit'+n)];
        const key=candidates.find(k=>!used.has(k));
        if(!key)throw Error('Keine freie Taste für neue Kicks.');
        p.keys[action]=key;used.add(key);p.padButtons[action]=-1;
      }
    });
    c.schemaVersion=2;
  }
  const modes = ['neutral', 'positive', 'lastInputWins'];
  if (!modes.includes(c.socd?.horizontal) || !modes.includes(c.socd?.vertical)) throw Error('Ungültige SOCD-Regel.');
  if (!Number.isInteger(c.bufferFrames) || c.bufferFrames < 1 || c.bufferFrames > 30) throw Error('Input-Buffer muss 1–30 Frames umfassen.');
  if (![c.deadzone, c.releaseThreshold, c.triggerThreshold].every(n => Number.isFinite(n) && n >= 0 && n <= 1) || c.releaseThreshold >= c.deadzone) throw Error('Ungültige Stick-/Trigger-Schwellen.');
  for (const p of c.players) {
    if (!ACTIONS.every(a => typeof p.keys?.[a] === 'string' && /^[A-Za-z0-9]{1,40}$/.test(p.keys[a]))) throw Error('Unvollständige oder ungültige Tastaturbelegung.');
    const indexes = [...Object.values(p.padDirections ?? {}), p.axes?.horizontal, p.axes?.vertical];
    if (!BUTTONS.every(b => Number.isInteger(p.padButtons?.[b]) && p.padButtons[b]>=-1 && p.padButtons[b]<=63) || !['up','down','left','right'].every(d => Number.isInteger(p.padDirections?.[d as 'up']))) throw Error('Unvollständige Controllerbelegung.');
    if (!indexes.every(n => Number.isInteger(n) && n >= 0 && n <= 63)) throw Error('Ungültiger Controllerindex.');
    if (p.gamepadIndex !== null && (!Number.isInteger(p.gamepadIndex) || p.gamepadIndex < 0 || p.gamepadIndex > 15)) throw Error('Ungültige Gerätezuordnung.');
  }
  if (c.players[0].gamepadIndex !== null && c.players[0].gamepadIndex === c.players[1].gamepadIndex) throw Error('Ein Gamepad darf nur einem Spieler zugeordnet sein.');
  return structuredClone(c);
}

export function saveJson(filename: string, value: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export class Devices {
  config: Controls = structuredClone(DEFAULT_CONTROLS);
  private held = new Set<string>();
  private taps = new Set<string>();
  private axes = [[0, 0], [0, 0]];
  capture: ((code: string) => void) | null = null;

  constructor() {
    try { const stored = localStorage.getItem('stickman.controls'); if (stored) this.config = validateControls(JSON.parse(stored)); } catch { /* Invalid stored settings fall back to defaults. */ }
    window.addEventListener('keydown', event => {
      if (this.capture) { event.preventDefault(); event.stopImmediatePropagation(); const capture = this.capture; this.capture = null; capture(event.code); return; }
      if ((event.target as HTMLElement).matches('input,select,textarea,button')) return;
      if (this.config.players.some(p => Object.values(p.keys).includes(event.code))) event.preventDefault();
      if (!this.held.has(event.code)) this.taps.add(event.code);
      this.held.add(event.code);
    });
    window.addEventListener('keyup', event => this.held.delete(event.code));
    window.addEventListener('blur', () => this.clear());
  }
  async loadConfiguration(): Promise<void> {
    const response = await fetch(`${import.meta.env.BASE_URL}config/controls.json`);
    if (!response.ok) throw Error('Konfigurationsdatei konnte nicht geladen werden.');
    const configured = validateControls(await response.json());
    try { const stored = localStorage.getItem('stickman.controls'); this.config = stored ? validateControls(JSON.parse(stored)) : configured; }
    catch { this.config = configured; }
  }
  clear(): void { this.held.clear(); this.taps.clear(); this.axes = [[0, 0], [0, 0]]; }
  persist(): void { this.config = validateControls(this.config); localStorage.setItem('stickman.controls', JSON.stringify(this.config)); this.clear(); }
  sample(pads: (PadReading | null)[] = Array.from(navigator.getGamepads?.() ?? [])): [RawInput, RawInput] {
    const inputs = this.config.players.map((profile, player) => {
      const raw = neutralInput(); raw.taps = 0;
      for (const direction of ['up', 'down', 'left', 'right'] as const) raw[direction] = this.held.has(profile.keys[direction]) || this.taps.has(profile.keys[direction]);
      for (const button of BUTTONS) {
        if (this.held.has(profile.keys[button])) raw.buttons |= buttonBit(button);
        if (this.taps.has(profile.keys[button])) raw.taps |= buttonBit(button);
      }
      const pad = profile.gamepadIndex === null ? null : pads[profile.gamepadIndex];
      if (pad?.connected) {
        const pressed = (index: number) => index>=0 && (pad.buttons[index]?.value ?? 0) >= this.config.triggerThreshold;
        for (const button of BUTTONS) if (pressed(profile.padButtons[button])) raw.buttons |= buttonBit(button);
        for (const direction of ['up','down','left','right'] as const) raw[direction] ||= pressed(profile.padDirections[direction]);
        for (const [axis, index] of [profile.axes.horizontal, profile.axes.vertical].entries()) {
          const value = pad.axes[index] ?? 0;
          const threshold = this.axes[player][axis] ? this.config.releaseThreshold : this.config.deadzone;
          this.axes[player][axis] = Math.abs(value) >= threshold ? Math.sign(value) : 0;
        }
        raw.left ||= this.axes[player][0] < 0; raw.right ||= this.axes[player][0] > 0;
        raw.up ||= this.axes[player][1] < 0; raw.down ||= this.axes[player][1] > 0;
      }
      return raw;
    });
    this.taps.clear();
    return inputs as [RawInput, RawInput];
  }
}
