import rules from '../data/rules.json';
import { KNOWLEDGE, MOVE_INFO, nextHitLevel, reaches } from './knowledge';
import type { View } from './observation';
import type { CpuProfile } from './profiles';
import { Rng } from './rng';
export type Intent =
  | { kind:'wait' | 'approach' | 'retreat' | 'jump'; score:number; reason:string }
  | { kind:'block'; low:boolean; score:number; reason:string }
  | { kind:'attack'; moveId:string; score:number; reason:string };
/** Movement-only intents; used while the CPU recovers from its own attack. */
export type MovementIntent = Exclude<Intent, { kind:'attack' | 'jump' }>;
export interface CpuBrain {
  decide(view: View): Intent;
  /** Optional: footwork during the post-attack thinking break. Must never attack. */
  recover?(view: View): MovementIntent;
}
/**
 * Tactical layer on top of the per-decision utility scores.
 * pressure – close in and attack (the former default behaviour)
 * footsies – hover just outside the opponent's reach, poke when they step in
 * backoff  – walk out of range after an own attack or after taking a hit
 */
export type Tactic = 'pressure' | 'footsies' | 'backoff';
const U = rules.unit;
/** Longest standing normal; both fighters share the same move set. */
const EFFECTIVE = Math.max(...KNOWLEDGE.filter(m=>m.stance==='standing' && m.command.type==='normal').map(m=>m.reach));
/** Preferred footsie distance: just outside the opponent's longest normal. */
export const SWEET_SPOT = EFFECTIVE + 18*U;
const MIN_BACK_ROOM = 95*U;
export class UtilityBrain implements CpuBrain {
  private recent: string[] = [];
  private lastState = '';
  private jumpHabit = 0;
  private guardHabit = 0;
  private guardingSince = -1;
  private commandMeter = 0;
  private commandUses = new Map<string, number>();
  private tactic: Tactic = 'footsies';
  private tacticUntil = -Infinity;
  private attackPending = false;
  private lastHp = -1;
  private lastOpponentHp = -1;
  constructor(private profile: CpuProfile, private rng: Rng) {}
  get currentTactic(): Tactic { return this.tactic; }
  /** Deterministic override for tests and the training overlay. */
  setTactic(tactic: Tactic, frame: number, min = 60, max = min): void {
    this.tactic = tactic;
    this.tacticUntil = frame + min + Math.floor(this.rng.next()*Math.max(0, max-min));
  }
  private backRoom(v: View): number {
    const { self:s, opponent:o } = v;
    return o && o.x>s.x ? s.x : rules.stageWidth-s.x;
  }
  /** Event-driven and time-driven tactic changes. Shared by decide() and recover(). */
  private updateTactic(v: View): void {
    const { self:s, opponent:o } = v, p = this.profile;
    if (!o) return;
    const distance = Math.abs(o.x-s.x), room = this.backRoom(v);
    const gotHit = this.lastHp>=0 && s.hp<this.lastHp;
    const landedHit = this.lastOpponentHp>=0 && o.hp<this.lastOpponentHp;
    this.lastHp = s.hp; this.lastOpponentHp = o.hp;
    // Own attack is over (decide/recover are never called mid-move): reset the spacing.
    const attackEnded = this.attackPending && s.state!=='Attack';
    if (attackEnded) this.attackPending = false;
    if (landedHit && this.rng.next() < .3+p.aggression) this.setTactic('pressure', v.frame, 40, 90);
    else if (gotHit && this.rng.next() < .6-p.aggression*.5) this.setTactic('backoff', v.frame, 20, 45);
    else if (attackEnded && this.rng.next() < .6-p.aggression*.6+(s.hp<rules.maxHealth*.3?.15:0))
      this.setTactic('backoff', v.frame, 16, 40);
    else if (v.frame>=this.tacticUntil) {
      const pressure = .25+p.aggression*1.2, footsies = .55, backoff = distance<SWEET_SPOT ? .12+(1-p.aggression)*.18 : 0;
      const roll = this.rng.next()*(pressure+footsies+backoff);
      if (roll<pressure) this.setTactic('pressure', v.frame, 45, 110);
      else if (roll<pressure+footsies) this.setTactic('footsies', v.frame, 50, 130);
      else this.setTactic('backoff', v.frame, 18, 40);
    }
    // Backing off is pointless once safe, and impossible with the wall behind us.
    if (this.tactic==='backoff' && (room<MIN_BACK_ROOM || distance>SWEET_SPOT+25*U))
      this.setTactic(room<MIN_BACK_ROOM ? 'pressure' : 'footsies', v.frame, 30, 70);
  }
  recover(v: View): MovementIntent {
    const { self:s, opponent:o } = v, p = this.profile;
    if (!o) return { kind:'wait', score:0, reason:'Denkpause' };
    this.updateTactic(v);
    const distance = Math.abs(o.x-s.x), room = this.backRoom(v);
    const enemyMove = o.state==='Attack' && o.moveId ? MOVE_INFO[o.moveId] : undefined;
    const level = enemyMove ? nextHitLevel(o.moveId,o.moveFrame) : null;
    if (level!==null && distance<(enemyMove?.reach ?? 0)+40*U && this.rng.next()<p.blockChance) {
      const correct = this.rng.next()<p.correctBlockChance;
      return { kind:'block', low:correct ? level==='LOW' : level!=='LOW', score:1.3, reason:`Denkpause: guard ${level}` };
    }
    const canRetreat = room>=MIN_BACK_ROOM;
    if (canRetreat && distance<SWEET_SPOT && (this.tactic!=='pressure' || this.rng.next()<.25))
      return { kind:'retreat', score:1, reason:'Denkpause: Abstand' };
    if (this.tactic!=='backoff' && distance>SWEET_SPOT+30*U && this.rng.next()<.5)
      return { kind:'approach', score:.5, reason:'Denkpause: aufrücken' };
    return { kind:'wait', score:0, reason:'Denkpause' };
  }
  decide(v: View): Intent {
    const { self:s, opponent:o } = v, p = this.profile;
    if (!o) return { kind:'wait', score:0, reason:'observe' };
    this.updateTactic(v);
    const tactic = this.tactic;
    const distance = Math.abs(o.x-s.x), corner = Math.min(s.x, rules.stageWidth-s.x) < 110*U;
    const room = this.backRoom(v), canRetreat = room>=MIN_BACK_ROOM;
    if (o.state !== this.lastState) {
      this.jumpHabit = this.jumpHabit*.9 + (o.state==='JumpSquat' ? .1 : 0);
      this.lastState = o.state;
    }
    this.guardHabit = this.guardHabit*.92 + ((o.state==='Blockstun' || (o.x-s.x)*o.vx>0) ? .08 : 0);
    const enemyMove = o.state==='Attack' && o.moveId ? MOVE_INFO[o.moveId] : undefined;
    const level = enemyMove ? nextHitLevel(o.moveId,o.moveFrame) : null;
    const recovery = enemyMove && o.moveFrame>enemyMove.lastActive ? enemyMove.duration-o.moveFrame : 0;
    const danger = level !== null && distance < (enemyMove?.reach ?? 0)+40*U;
    // Opponent walks into our range: the classic moment for a poke.
    const steppingIn = o.state==='Walk' && (s.x-o.x)*o.vx>0 && o.y===0;
    const steppingOut = o.state==='Walk' && (s.x-o.x)*o.vx<0;
    const choices: Intent[] = [];
    const add = (i: Intent) => choices.push(i);
    const lowHealth = s.hp < rules.maxHealth*.3;
    const protectLead = v.round.timer < 15*rules.hz && s.hp>o.hp;
    if (danger && this.rng.next()<p.blockChance && (this.guardingSince<0 || v.frame-this.guardingSince<90)) {
      const correct = this.rng.next()<p.correctBlockChance;
      add({kind:'block', low:correct ? level==='LOW' : level!=='LOW', score:1.3+(lowHealth?.1:0), reason:`guard ${level}`});
    }
    const aerial = o.y<0 || o.state==='JumpSquat';
    const antiAir = aerial && this.rng.next()<Math.min(.95,p.antiAirChance+this.jumpHabit*p.adaptation);
    const punish = recovery>0 && this.rng.next()<p.punishChance;
    const allowHold = this.rng.next()<p.holdChance;
    const executionError = this.rng.next()<p.executionError;
    const candidates = KNOWLEDGE.filter(m => (s.y<0 ? m.stance==='airborne' : m.stance!=='airborne') &&
      (m.command.type==='normal' || (m.command.buttons.length===1 && allowHold)) &&
      reaches(m,s,o,executionError ? 10*U : 0));
    const fastest = candidates.filter(m => m.startup+1<=recovery).sort((a,b) => a.startup-b.startup)[0];
    for (const m of candidates) {
      const repeats = this.recent.filter(id => id===m.id).length;
      const isPunish = punish && fastest?.id===m.id;
      // Faster profiles attach more value to initiative; damage alone would select slow heavies.
      let score = .42+p.aggression*.45 + m.damage/500 - m.startup*(.006+p.aggression*.017)
        -m.recovery*.003 + Math.min(0,m.blockAdvantage)*.002 -repeats*.22 +this.rng.next()*.28;
      if (m.boxes.some(b=>b.level==='LOW')) score += this.guardHabit*p.adaptation*.7 + (o.state==='Blockstun'&&!o.crouching?.3:0);
      if (danger) score -= .18;
      if (aerial) score += antiAir ? .5 : -.35;
      if (isPunish) score += 1;
      if (lowHealth && m.recovery>20) score -= .15;
      if (protectLead) score -= .22;
      // Tactics shape how eagerly buttons are pressed; punishes and anti-airs stay intact.
      if (!isPunish && !(aerial && antiAir)) {
        if (tactic==='footsies') score += steppingIn ? .15 + m.startup*-.004 : -.28;
        else if (tactic==='backoff') score -= .6;
      }
      add({kind:'attack',moveId:m.id,score,
        reason:isPunish?'punish':aerial&&antiAir?'anti-air':tactic==='footsies'&&steppingIn?'poke':'attack'});
    }
    // Footwork, scored per tactic.
    const r = this.rng.next();
    let approach: number, retreat: number, wait = .12+this.rng.next()*(1-p.aggression)*.48;
    let approachReason = corner ? 'leave corner' : 'spacing', retreatReason = 'spacing';
    if (tactic==='pressure') {
      approach = distance>EFFECTIVE ? .95 : .25;
      retreat = .06+r*.14;
    } else if (tactic==='footsies') {
      if (distance>SWEET_SPOT+25*U) { approach = .8; retreat = .05; approachReason = 'footsies: aufrücken'; }
      else if (distance<SWEET_SPOT-6*U) { approach = .1; retreat = .75+r*.3; retreatReason = 'footsies: Abstand'; }
      else { // inside the sweet band: small, irregular steps
        approach = .22+r*.4+(steppingOut?.25:0); retreat = .22+(1-r)*.4; wait += .12;
        approachReason = retreatReason = 'footsies: tänzeln';
      }
    } else {
      approach = 0; retreat = 1.15+r*.1; retreatReason = 'zurückziehen';
    }
    if (corner && !canRetreat) approach += .45;
    if (!canRetreat) retreat = -.5;
    if (protectLead) { retreat += .55; retreatReason = 'protect lead'; }
    if (aerial && !antiAir) retreat += .3;
    add({kind:'approach',score:approach,reason:approachReason});
    add({kind:'retreat',score:retreat,reason:retreatReason});
    add({kind:'wait',score:wait,reason:'hesitate'});
    // Targeted jumps only: evade a visible low or bridge a substantial gap, never idle hopping.
    if (s.y===0 && ((level==='LOW' && distance<EFFECTIVE) || (tactic==='pressure' && distance>EFFECTIVE*1.6 && distance<EFFECTIVE*2.5)) && this.rng.next()<.035)
      add({kind:'jump',score:1,reason:level==='LOW'?'evade low':'close distance'});
    choices.sort((a,b)=>b.score-a.score);
    let result = choices[0];
    // Rotate the complete directional repertoire, including single-button kicks.
    // Choose a target before checking reach so long kicks cannot permanently keep
    // the CPU outside uppercut range. Guarding and a confirmed punish take priority.
    // Only the pressure tactic walks in for a command move; footsies uses it when
    // the opponent is already in range, backoff never.
    const uppercut = MOVE_INFO.jumping_uppercut;
    this.commandMeter=Math.min(1,this.commandMeter+.5+p.comboChance*.5);
    if (s.y===0 && !danger && tactic!=='backoff' && result.kind!=='block' && result.reason!=='punish' && !protectLead &&
      MOVE_INFO[this.recent.at(-1)??'']?.command.type!=='hold') {
      const commands = KNOWLEDGE.filter(m=>m.stance==='standing' && m.command.type==='hold' &&
        !this.recent.slice(-2).includes(m.id) && reaches(m,s,o,35*U));
      const ranked = commands.map(m=>({m, rank:(this.commandUses.get(m.id)??0)+this.rng.next()*.5-(m.id===uppercut?.id? .5:0)}));
      ranked.sort((a,b)=>a.rank-b.rank);
      const target = ranked[0]?.m;
      if (target) {
        if (this.commandMeter>=1) {
          if (reaches(target,s,o)) {
            this.commandMeter=0;
            this.commandUses.set(target.id,(this.commandUses.get(target.id)??0)+1);
            result={kind:'attack',moveId:target.id,score:1.05,
              reason:target.id===uppercut?.id ? (aerial?'anti-air':'uppercut') : 'kick combo'};
          } else if (!aerial && tactic==='pressure') {
            result={kind:'approach',score:1.05,reason:`range for ${target.id}`};
          }
        }
      }
    }
    if (result.kind==='attack') {
      if (executionError && result.reason!=='kick combo' && result.moveId!==uppercut?.id) {
        if (this.rng.next()<.5) result={kind:'wait',score:result.score,reason:'late execution'};
        else {
          const alternatives=candidates.filter(m=>m.command.type==='normal');
          if (alternatives.length) result={...result,moveId:alternatives[Math.floor(this.rng.next()*alternatives.length)].id,reason:'wrong button'};
        }
      }
      if (result.kind==='attack') { this.recent.push(result.moveId); if(this.recent.length>6)this.recent.shift(); this.attackPending=true; }
    }
    if(result.kind==='block') { if(this.guardingSince<0)this.guardingSince=v.frame; } else this.guardingSince=-1;
    return result;
  }
}
