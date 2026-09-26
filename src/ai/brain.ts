import rules from '../data/rules.json';
import { KNOWLEDGE, MOVE_INFO, nextHitLevel, reaches } from './knowledge';
import type { View } from './observation';
import type { CpuProfile } from './profiles';
import { Rng } from './rng';
export type Intent =
  | { kind:'wait' | 'approach' | 'retreat' | 'jump'; score:number; reason:string }
  | { kind:'block'; low:boolean; score:number; reason:string }
  | { kind:'attack'; moveId:string; score:number; reason:string };
export interface CpuBrain { decide(view: View): Intent }
export class UtilityBrain implements CpuBrain {
  private recent: string[] = [];
  private lastState = '';
  private jumpHabit = 0;
  private guardHabit = 0;
  private guardingSince = -1;
  private commandMeter = 0;
  private commandUses = new Map<string, number>();
  constructor(private profile: CpuProfile, private rng: Rng) {}
  decide(v: View): Intent {
    const { self:s, opponent:o } = v, p = this.profile;
    if (!o) return { kind:'wait', score:0, reason:'observe' };
    const distance = Math.abs(o.x-s.x), corner = Math.min(s.x, rules.stageWidth-s.x) < 110*rules.unit;
    if (o.state !== this.lastState) {
      this.jumpHabit = this.jumpHabit*.9 + (o.state==='JumpSquat' ? .1 : 0);
      this.lastState = o.state;
    }
    this.guardHabit = this.guardHabit*.92 + ((o.state==='Blockstun' || (o.x-s.x)*o.vx>0) ? .08 : 0);
    const enemyMove = o.state==='Attack' && o.moveId ? MOVE_INFO[o.moveId] : undefined;
    const level = enemyMove ? nextHitLevel(o.moveId,o.moveFrame) : null;
    const recovery = enemyMove && o.moveFrame>enemyMove.lastActive ? enemyMove.duration-o.moveFrame : 0;
    const danger = level !== null && distance < (enemyMove?.reach ?? 0)+40*rules.unit;
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
      reaches(m,s,o,executionError ? 10*rules.unit : 0));
    const fastest = candidates.filter(m => m.startup+1<=recovery).sort((a,b) => a.startup-b.startup)[0];
    for (const m of candidates) {
      const repeats = this.recent.filter(id => id===m.id).length;
      // Faster profiles attach more value to initiative; damage alone would select slow heavies.
      let score = .42+p.aggression*.45 + m.damage/500 - m.startup*(.006+p.aggression*.017)
        -m.recovery*.003 + Math.min(0,m.blockAdvantage)*.002 -repeats*.22 +this.rng.next()*.28;
      if (m.boxes.some(b=>b.level==='LOW')) score += this.guardHabit*p.adaptation*.7 + (o.state==='Blockstun'&&!o.crouching?.3:0);
      if (danger) score -= .18;
      if (aerial) score += antiAir ? .5 : -.35;
      if (punish && fastest?.id===m.id) score += 1;
      if (lowHealth && m.recovery>20) score -= .15;
      if (protectLead) score -= .22;
      add({kind:'attack',moveId:m.id,score,reason:punish&&fastest?.id===m.id?'punish':antiAir?'anti-air':'attack'});
    }
    const effective = Math.max(...KNOWLEDGE.filter(m=>m.stance==='standing' && m.command.type==='normal').map(m=>m.reach));
    add({kind:'approach',score:distance>effective ? .95 : .25+(corner?.45:0),reason:corner?'leave corner':'spacing'});
    add({kind:'retreat',score:(corner ? -.5 : .12+this.rng.next()*.24)+(protectLead?.55:0)+(aerial&&!antiAir?.3:0),reason:protectLead?'protect lead':'spacing'});
    add({kind:'wait',score:.12+this.rng.next()*(1-p.aggression)*.48,reason:'hesitate'});
    // Targeted jumps only: evade a visible low or bridge a substantial gap, never idle hopping.
    if (s.y===0 && ((level==='LOW' && distance<effective) || (distance>effective*1.6 && distance<effective*2.5)) && this.rng.next()<.035)
      add({kind:'jump',score:1,reason:level==='LOW'?'evade low':'close distance'});
    choices.sort((a,b)=>b.score-a.score);
    let result = choices[0];
    // Rotate the complete directional repertoire, including single-button kicks.
    // Choose a target before checking reach so long kicks cannot permanently keep
    // the CPU outside uppercut range. Guarding and a confirmed punish take priority.
    const uppercut = MOVE_INFO.jumping_uppercut;
    this.commandMeter=Math.min(1,this.commandMeter+.5+p.comboChance*.5);
    if (s.y===0 && !danger && result.kind!=='block' && result.reason!=='punish' && !protectLead &&
      MOVE_INFO[this.recent.at(-1)??'']?.command.type!=='hold') {
      const commands = KNOWLEDGE.filter(m=>m.stance==='standing' && m.command.type==='hold' &&
        !this.recent.slice(-2).includes(m.id) && reaches(m,s,o,35*rules.unit));
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
          } else if (!aerial) {
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
      if (result.kind==='attack') { this.recent.push(result.moveId); if(this.recent.length>6)this.recent.shift(); }
    }
    if(result.kind==='block') { if(this.guardingSince<0)this.guardingSince=v.frame; } else this.guardingSince=-1;
    return result;
  }
}
