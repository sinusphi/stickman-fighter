import type { GameState } from '../simulation/types';
import { neutralInput, type RawInput } from '../input/types';
import { UtilityBrain, type CpuBrain, type Intent } from './brain';
import { Controller } from './controller';
import { MOVE_INFO } from './knowledge';
import { observe, Perception } from './observation';
import { PROFILES, type CpuProfile, type Difficulty } from './profiles';
import { Rng } from './rng';
export type BrainFactory = (profile: CpuProfile, rng: Rng) => CpuBrain;
export class CpuPlayer {
  private perception: Perception;
  private controller = new Controller();
  private brain!: CpuBrain;
  private lastFrame=-1;
  private lastRound=0;
  private lastDecision=-Infinity;
  private pauseUntil=-Infinity;
  private wasAttacking=false;
  private event='';
  private committed: Intent | null = null;
  private profile: CpuProfile;
  debug: Intent = {kind:'wait',score:0,reason:'observe'};
  constructor(readonly difficulty: Difficulty = 'medium', private player: 0 | 1 = 1,
    private factory: BrainFactory = (p,rng)=>new UtilityBrain(p,rng)) {
    this.profile=PROFILES[difficulty]; this.perception=new Perception(this.profile.reactionFrames); this.reset(1);
  }
  reset(seed: number): void {
    this.brain=this.factory(this.profile,new Rng(seed)); this.perception.reset(); this.controller.clear();
    this.lastFrame=-1;this.lastRound=0;this.lastDecision=-Infinity;this.pauseUntil=-Infinity;this.wasAttacking=false;this.event='';
    this.committed=null;this.debug={kind:'wait',score:0,reason:'observe'};
  }
  next(game: GameState): RawInput {
    if(game.frame<=this.lastFrame || game.round.number!==this.lastRound) {
      this.perception.reset();this.controller.clear();this.lastDecision=-Infinity;this.event='';
    }
    this.lastFrame=game.frame;this.lastRound=game.round.number;
    const v=this.perception.next(observe(game),this.player),s=v.self,o=v.opponent;
    if(s.state==='Attack')this.wasAttacking=true;
    else if(this.wasAttacking) {
      this.wasAttacking=false;
      this.pauseUntil=v.frame+this.profile.attackPauseFrames;
      this.controller.clear();
      this.event='';this.lastDecision=-Infinity;
    }
    if((game.training.enabled && game.training.dummy !== 'cpu') || v.round.phase!=='fighting' || v.hitstop>0 || ['Hitstun','Blockstun','Knockdown','KO','Landing'].includes(s.state)) {
      this.controller.clear();this.lastDecision=-Infinity;
      this.debug={kind:'wait',score:0,reason:v.hitstop?'hitstop':v.round.phase!=='fighting'?v.round.phase:s.state};
      return neutralInput();
    }
    // Existing sequences finish; once a move starts, no recovery-buffer attack is manufactured.
    if(this.controller.busy)return this.controller.next(s);
    if(s.state==='Attack' || s.state==='JumpSquat') {
      if(s.state==='Attack' && s.moveId) this.debug=this.committed?.kind==='attack' && this.committed.moveId===s.moveId
        ? this.committed : {kind:'attack',moveId:s.moveId,score:0,reason:'attack'};
      return neutralInput();
    }
    if(v.frame<this.pauseUntil) {
      // Thinking break after an own attack: never attack, but footwork (backing off,
      // guarding) is allowed so the CPU does not stand frozen in front of the opponent.
      if(!o || !this.brain.recover) {
        this.debug={kind:'wait',score:0,reason:'Denkpause'};
        return neutralInput();
      }
      if(v.frame-this.lastDecision>=this.profile.decisionFrames) {
        this.debug=this.brain.recover(v);this.controller.set(this.debug,s);this.lastDecision=v.frame;
      }
      return this.controller.next(s);
    }
    const move=o?.moveId ? MOVE_INFO[o.moveId] : undefined;
    const event=o ? `${o.state}/${o.moveId}/${move && o.moveFrame>move.lastActive}/${v.lastContact?.frame}` : '';
    if(o && (event!==this.event || v.frame-this.lastDecision>=this.profile.decisionFrames)) {
      this.debug=this.brain.decide(v);this.committed=this.debug;this.controller.set(this.debug,s);
      this.lastDecision=v.frame;this.event=event;
    }
    return this.controller.next(s);
  }
}
