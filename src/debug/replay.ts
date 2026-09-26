import figureScale from '../data/figure-scale.json';
import rules from '../data/rules.json';
import moves from '../data/moves.json';
import bodies from '../data/bodies.json';
import motions from '../data/motions.json';
import { MOVES, validateResources } from '../data/schema';
import { snapshot, step } from '../simulation/state';
import type { GameState } from '../simulation/types';
import type { ControlEvent } from '../simulation/events';
import { BUTTONS, BUTTON_MASK, type InputFrame, type RawInput } from '../input/types';

export const ENGINE_VERSION = '1.3.0';
export const MAX_REPLAY_FRAMES = rules.maxReplayFrames;
export interface ReplayFrame { inputs: [RawInput, RawInput]; events: ControlEvent[] }
export interface Replay { schemaVersion: number; engineVersion: string; dataHash: string; initial: GameState; frames: ReplayFrame[] }

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical((value as Record<string,unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function hash(value: unknown): string {
  const text = canonical(value); let result = 2166136261;
  for (let i=0;i<text.length;i++) result = Math.imul(result ^ text.charCodeAt(i),16777619);
  return (result>>>0).toString(16).padStart(8,'0');
}
export const DATA_HASH = hash({ rules,moves,bodies,motions,figureScale });

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw Error(`Ungültiges Replay: ${message}`); }
const int = (n: number, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && n >= min && n <= max;
export function validRaw(raw: RawInput): boolean {
  return !!raw && ['up','down','left','right'].every(k=>typeof raw[k as 'up']==='boolean') && int(raw.buttons,0,BUTTON_MASK) && (raw.taps===undefined || int(raw.taps,0,BUTTON_MASK));
}
function validFrame(frame: InputFrame): boolean { return !!frame && int(frame.frame,-1) && int(frame.direction,1,9) && [frame.pressed,frame.held,frame.released].every(n=>int(n,0,BUTTON_MASK)); }
function validConfig(config: GameState['inputConfig']): boolean { return !!config && ['neutral','positive','lastInputWins'].includes(config.socd?.horizontal) && ['neutral','positive','lastInputWins'].includes(config.socd?.vertical) && int(config.bufferFrames,1,30); }

export function validateSnapshot(value: unknown): GameState {
  const state = value as GameState;
  assert(state?.schemaVersion===2 && int(state.frame) && int(state.combatFrame) && int(state.hitstop,0,120), 'Snapshot-Version oder Frame-Zähler.');
  assert(validConfig(state.inputConfig), 'Input-Konfiguration.');
  assert(state.training && typeof state.training.enabled==='boolean' && ['stand','crouch','block','cpu'].includes(state.training.dummy),'Trainingszustand.');
  assert(state.round && ['fighting','roundOver','matchOver'].includes(state.round.phase) && int(state.round.timer,0,rules.hz*rules.roundSeconds) && int(state.round.number,1) && int(state.round.transition,0,rules.roundTransition) && state.round.wins?.length===2 && state.round.wins.every(n=>int(n,0,2)) && [null,0,1].includes(state.round.winner) && [null,'KO','TIME OVER','DOUBLE KO','DRAW'].includes(state.round.reason), 'Rundenzustand.');
  assert(state.fighters?.length===2,'Zwei Figuren erforderlich.');
  const states = ['Idle','Walk','Crouch','CrouchWalk','JumpSquat','Airborne','Landing','Attack','Hitstun','Blockstun','Knockdown','KO'];
  for (const [index,f] of state.fighters.entries()) {
    validateResources(f.resources);
    assert(f.id===index && states.includes(f.state) && [-1,1].includes(f.facing) && [-1,1].includes(f.attackFacing),'Figurenzustand oder Blickrichtung.');
    assert([f.x,f.y,f.vx,f.vy,f.jumpX].every(n=>int(n,-rules.stageWidth,rules.stageWidth)) && int(f.hp,0,rules.maxHealth),'Position, Geschwindigkeit oder HP.');
    assert([f.remaining,f.stateFrame,f.moveFrame,f.attackId,f.landingRecovery,f.comboCount,f.damageScalePermille,f.juggleState].every(n=>int(n)) && typeof f.airAttackUsed==='boolean' && typeof f.crouching==='boolean','Figurenzähler.');
    assert(f.hitReaction===undefined || f.hitReaction==='middlePunch' && f.state==='Hitstun','Trefferreaktion.');
    assert((f.moveId===null || Object.hasOwn(MOVES,f.moveId)) && (f.state!=='Attack' || (f.moveId!==null && f.moveFrame<MOVES[f.moveId].duration)),'Move oder Move-Frame.');
    assert(Array.isArray(f.hitTargets) && f.hitTargets.every(id=>typeof id==='string') && (f.advantage==='pending' || f.advantage==='n/a' || int(f.advantage,-10000,10000)),'Kontaktzustand.');
    const input=f.input;
    assert(input && validRaw(input.previous) && validFrame(input.current) && [-1,0,1].includes(input.horizontalLast) && [-1,0,1].includes(input.verticalLast),'Input-Zustand.');
    assert(input.history?.frames?.length===rules.historySize && int(input.history.cursor,0,rules.historySize-1) && int(input.history.length,0,rules.historySize) && input.history.frames.every(f=>f===null || validFrame(f)), 'Input-Ringpuffer.');
    for(let i=0;i<input.history.length;i++) assert(input.history.frames[(input.history.cursor-1-i+rules.historySize)%rules.historySize]!==null,'Lücke im Input-Ringpuffer.');
    assert(input.pending===null || (!!input.pending && BUTTONS.includes(input.pending.button) && int(input.pending.expires) && Array.isArray(input.pending.motions) && input.pending.motions.every(m=>typeof m==='string')),'Gepufferter Command.');
    assert(Array.isArray(input.motions) && input.motions.every(m=>typeof m==='string'),'Motion-Erkennung.');
    assert(Array.isArray(input.display) && input.display.length<=rules.displayHistorySize && input.display.every(entry=>validFrame(entry)&&int(entry.duration,1)),'Input-Anzeige.');
  }
  assert(state.lastContact===null || ([0,1].includes(state.lastContact.attacker) && [0,1].includes(state.lastContact.defender) && typeof state.lastContact.blocked==='boolean' && int(state.lastContact.frame)),'Letzter Kontakt.');
  assert(state.lastContact?.hitLevel===undefined || ['LOW','MID','HIGH'].includes(state.lastContact.hitLevel),'Kontakt-Level.');
  assert(Array.isArray(state.measurements) && state.measurements.length<=2 && state.measurements.every(m=>[0,1].includes(m.attacker)&&[0,1].includes(m.defender)&&(m.attackerReady===null||int(m.attackerReady))&&(m.defenderReady===null||int(m.defenderReady))&&typeof m.complete==='boolean'),'Frame-Vorteil-Messung.');
  return snapshot(state);
}
function validEvent(event: ControlEvent): boolean {
  if (!event) return false;
  if (event.type==='reset') return true;
  if (event.type==='training') return typeof event.enabled==='boolean' && ['stand','crouch','block','cpu'].includes(event.dummy);
  return event.type==='inputConfig' && validConfig(event.config);
}
export function parseReplay(value: unknown): Replay {
  const replay=structuredClone(value) as Replay;
  assert(replay && replay.schemaVersion===2 && replay.engineVersion===ENGINE_VERSION && replay.dataHash===DATA_HASH,'Version oder Spieldaten passen nicht zu diesem Build (Engine 1.3.0). Replays aus früheren Updates verwenden andere Kampfregeln oder Figurengrößen.');
  validateSnapshot(replay.initial);
  assert(Array.isArray(replay.frames) && replay.frames.length<=MAX_REPLAY_FRAMES,'Replay ist zu lang oder enthält keine Frame-Liste.');
  for (const frame of replay.frames) assert(frame?.inputs?.length===2 && frame.inputs.every(validRaw) && Array.isArray(frame.events) && frame.events.length<=10 && frame.events.every(validEvent),'Ungültige Frame-Eingaben oder Steuerereignisse.');
  return structuredClone(replay);
}
export function createReplay(game: GameState): Replay { return { schemaVersion:2, engineVersion:ENGINE_VERSION, dataHash:DATA_HASH, initial:snapshot(game), frames:[] }; }
export function playReplay(replay: Replay, onFrame?: (state: GameState) => void): GameState {
  const checked=parseReplay(replay);
  const game=validateSnapshot(checked.initial);
  for(const frame of checked.frames) { step(game,frame.inputs,frame.events); onFrame?.(game); }
  return game;
}
