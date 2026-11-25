import { MOVES, advanceAt } from '../data/schema';
import rules from '../data/rules.json';
import type { Fighter, FighterState } from './types';

const groundActionable: FighterState[] = ['Idle', 'Walk', 'Run', 'Crouch', 'CrouchWalk'];
export function isGroundActionable(f: Fighter): boolean { return groundActionable.includes(f.state); }
export function isActionable(f: Fighter): boolean { return isGroundActionable(f) || (f.state === 'Airborne' && !f.airAttackUsed); }
export function transition(f: Fighter, state: FighterState, remaining = 0): void {
  delete f.hitReaction; delete f.thrownBy;
  f.state = state; f.stateFrame = 0; f.remaining = remaining;
}
export function recoverGround(f: Fighter): void {
  const direction = f.input.current.direction;
  f.crouching = direction <= 3;
  transition(f, f.crouching ? 'Crouch' : direction === 4 || direction === 6 ? 'Walk' : 'Idle');
}
/** Contact with the opponent ends a run: the fighter walks on and needs a new double tap. */
export function stopRun(f: Fighter): void {
  if (f.state !== 'Run') return;
  f.input.run = false;
  transition(f, 'Walk');
  f.vx = f.facing * rules.forwardSpeed;
}
export function moveFighter(f: Fighter, stationary = false): boolean {
  f.stateFrame++;
  // A thrown fighter follows the thrower's table (simulation/throws), no own physics.
  if (f.state === 'Thrown') return false;
  if(f.state==='Attack' && f.moveId && f.y===0) {
    const advance=MOVES[f.moveId].advance;
    if(advance) f.x+=f.attackFacing*(advanceAt(advance,f.moveFrame)-advanceAt(advance,f.moveFrame-1));
  }
  if(f.state==='Hitstun' && f.y===0 && f.hitReaction==='middlePunch') {
    f.x+=f.vx;
    f.vx=Math.sign(f.vx)*Math.max(0,Math.abs(f.vx)-rules.hitSlideFriction);
  }
  if (f.state === 'Blockstun') { f.crouching = f.input.current.direction <= 3; f.vx = 0; }
  if (['Landing', 'Hitstun', 'Blockstun'].includes(f.state)) {
    f.remaining--;
    if (f.remaining <= 0) recoverGround(f);
  }
  if (f.state === 'JumpSquat') {
    if (--f.remaining <= 0) { transition(f, 'Airborne'); f.vx = f.jumpX; f.vy = rules.jumpVelocity; f.crouching = false; }
  }
  const readyBeforeMovement = isGroundActionable(f);
  // Attacks, stun, jumps and throws end a run; it needs a fresh double tap afterwards.
  if (!readyBeforeMovement) f.input.run = false;
  if (readyBeforeMovement) {
    const direction = f.input.current.direction;
    f.vx = 0;
    if (direction >= 7) {
      f.jumpX = (direction - 8) * rules.jumpSpeed * f.facing || 0;
      f.airAttackUsed = false; transition(f, 'JumpSquat', rules.jumpSquat);
    } else {
      const crouching = direction <= 3;
      const horizontal = stationary || crouching ? 0 : (direction - 1) % 3 - 1;
      // A run only holds while forward stays pressed (input.run clears on any other direction).
      const running = horizontal > 0 && f.input.run;
      const next: FighterState = crouching ? 'Crouch' : running ? 'Run' : horizontal ? 'Walk' : 'Idle';
      if (f.state !== next) transition(f, next);
      f.crouching = crouching;
      f.vx = horizontal * f.facing * (running ? rules.runSpeed : horizontal > 0 ? rules.forwardSpeed : rules.backwardSpeed) || 0;
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
