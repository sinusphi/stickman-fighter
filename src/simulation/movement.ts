import { MOVES } from '../data/schema';
import rules from '../data/rules.json';
import type { Fighter, FighterState } from './types';

const groundActionable: FighterState[] = ['Idle', 'Walk', 'Crouch', 'CrouchWalk'];
export function isGroundActionable(f: Fighter): boolean { return groundActionable.includes(f.state); }
export function isActionable(f: Fighter): boolean { return isGroundActionable(f) || (f.state === 'Airborne' && !f.airAttackUsed); }
export function transition(f: Fighter, state: FighterState, remaining = 0): void {
  delete f.hitReaction;
  f.state = state; f.stateFrame = 0; f.remaining = remaining;
}
export function recoverGround(f: Fighter): void {
  const direction = f.input.current.direction;
  f.crouching = direction <= 3;
  transition(f, f.crouching ? direction === 3 ? 'CrouchWalk' : 'Crouch' : direction === 4 || direction === 6 ? 'Walk' : 'Idle');
}
export function moveFighter(f: Fighter, stationary = false): boolean {
  f.stateFrame++;
  if(f.state==='Attack' && f.moveId && f.y===0) {
    const advance=MOVES[f.moveId].advance;
    if(advance) {
      const offset=(frame:number)=>{const t=Math.max(0,Math.min(1,frame/advance.frames));return Math.round(advance.distance*t*t*(3-2*t));};
      f.x+=f.attackFacing*(offset(f.moveFrame)-offset(f.moveFrame-1));
    }
  }
  if(f.state==='Hitstun' && f.y===0 && f.hitReaction==='middlePunch') {
    f.x+=f.vx;
    f.vx=Math.sign(f.vx)*Math.max(0,Math.abs(f.vx)-rules.hitSlideFriction);
  }
  if (f.state === 'Blockstun') { f.crouching = f.input.current.direction === 1; f.vx = 0; }
  if (['Landing', 'Hitstun', 'Blockstun'].includes(f.state)) {
    f.remaining--;
    if (f.remaining <= 0) recoverGround(f);
  }
  if (f.state === 'JumpSquat') {
    if (--f.remaining <= 0) { transition(f, 'Airborne'); f.vx = f.jumpX; f.vy = rules.jumpVelocity; f.crouching = false; }
  }
  const readyBeforeMovement = isGroundActionable(f);
  if (readyBeforeMovement) {
    const direction = f.input.current.direction;
    f.vx = 0;
    if (direction >= 7) {
      f.jumpX = (direction - 8) * rules.jumpSpeed * f.facing || 0;
      f.airAttackUsed = false; transition(f, 'JumpSquat', rules.jumpSquat);
    } else {
      const crouching = direction <= 3;
      // Down-back holds a stationary crouching guard (see canBlock); only
      // down-forward walks in the crouch.
      const horizontal = stationary || direction === 1 ? 0 : (direction - 1) % 3 - 1;
      const next: FighterState = crouching ? horizontal ? 'CrouchWalk' : 'Crouch' : horizontal ? 'Walk' : 'Idle';
      if (f.state !== next) transition(f, next);
      f.crouching = crouching;
      f.vx = horizontal * f.facing * (crouching ? rules.crouchForwardSpeed : horizontal > 0 ? rules.forwardSpeed : rules.backwardSpeed) || 0;
      f.x += f.vx;
    }
  }
  if (f.y < 0 || f.state === 'Airborne' || (f.state === 'Knockdown' && f.vy < 0)) {
    f.x += f.vx; f.y += f.vy; f.vy += rules.gravity;
    if (f.y >= 0) {
      f.y = 0; f.vy = 0; f.vx = 0;
      if (f.state === 'KO') { f.moveId = null; }
      else if (f.state === 'Knockdown') { f.remaining = rules.knockdownFrames; }
      else { transition(f, 'Landing', Math.max(rules.landingFrames, f.landingRecovery)); f.moveId = null; f.landingRecovery = 0; }
    }
  } else if (f.state === 'Knockdown' && --f.remaining <= 0) recoverGround(f);
  return readyBeforeMovement || isActionable(f);
}
