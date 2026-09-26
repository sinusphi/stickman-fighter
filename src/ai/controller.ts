import { buttonBit, neutralInput, type RawInput } from '../input/types';
import type { Facing } from '../simulation/types';
import type { Intent } from './brain';
import { MOVE_INFO } from './knowledge';
import type { VisibleFighter } from './observation';
interface CommandFrame { direction: number; buttons: number; waitAir?: boolean }
/** Relative numpad direction, converted at emission so crossing sides cannot stale a queue. */
export function directionInput(direction: number, facing: Facing, buttons = 0): RawInput {
  const horizontal = (direction-1)%3-1;
  return { left:horizontal*facing<0, right:horizontal*facing>0, up:direction>=7, down:direction<=3, buttons };
}
export class Controller {
  private queue: CommandFrame[] = [];
  private intent: Intent = { kind:'wait', score:0, reason:'idle' };
  get busy(): boolean { return this.queue.length>0; }
  clear(): void { this.queue=[]; this.intent={kind:'wait',score:0,reason:'interrupted'}; }
  set(intent: Intent, self: VisibleFighter): void {
    this.queue=[]; this.intent=intent;
    if (intent.kind!=='attack') return;
    const move=MOVE_INFO[intent.moveId];
    if (!move) { this.clear(); return; }
    // Release every button and stand up before hold eligibility is sampled by the engine.
    this.queue.push({ direction:move.stance==='crouching'?2:5, buttons:0 });
    if (move.stance==='airborne' && self.y===0) this.queue.push({direction:8,buttons:0,waitAir:true});
    const direction=move.command.type==='hold' ? move.command.directions[0] : move.stance==='crouching'?2:5;
    this.queue.push({direction,buttons:move.command.buttons.reduce((bits,b)=>bits|buttonBit(b),0)});
    this.queue.push({direction:5,buttons:0});
  }
  next(self: VisibleFighter): RawInput {
    const frame=this.queue[0];
    if(frame) {
      if(frame.waitAir && self.y<0) { this.queue.shift(); return this.next(self); }
      if(!frame.waitAir)this.queue.shift();
      return directionInput(frame.direction,self.facing,frame.buttons);
    }
    switch(this.intent.kind) {
      case 'approach': return directionInput(6,self.facing);
      case 'retreat': return directionInput(4,self.facing);
      case 'block': return directionInput(this.intent.low?1:4,self.facing);
      case 'jump': this.intent={kind:'wait',score:0,reason:'jumping'}; return directionInput(9,self.facing);
      default:return neutralInput();
    }
  }
}
