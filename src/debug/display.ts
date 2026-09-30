import { BUTTONS, buttonBit } from '../input/types';
import type { Fighter } from '../simulation/types';
import { MOVES } from '../data/schema';
import { t } from '../platform/i18n';

export function inputLines(f: Fighter): string {
  return [...f.input.display].reverse().map(entry=>{
    const buttons=BUTTONS.filter(b=>(entry.held|entry.pressed|entry.released)&buttonBit(b)).map(b=>`${entry.pressed&buttonBit(b)?'+':entry.released&buttonBit(b)?'−':''}${b}`).join(' ');
    return `${entry.direction}  ${buttons.padEnd(18)} ${String(entry.duration).padStart(3)}f`;
  }).join('\n');
}
export function stateLine(f: Fighter): string {
  const move=f.moveId?MOVES[f.moveId]:null;
  // A secondary strike window (the knee before a kick) is shown by its group name.
  const early=move?.hitGroups.find(g=>g.activeFrames && f.moveFrame>=g.activeFrames[0] && f.moveFrame<=g.activeFrames[1]);
  const phase=move?(early?`ACTIVE ${early.id.toUpperCase()}`:f.moveFrame<move.startup?'STARTUP':f.moveFrame<move.startup+move.active?'ACTIVE':'RECOVERY'):'—';
  const advantage=typeof f.advantage==='number'?`${f.advantage>=0?'+':''}${f.advantage}f`:f.advantage;
  return `P${f.id+1}  ${f.state} / ${phase}\nState ${f.stateFrame}f · Move ${move?`${f.moveFrame}/${move.duration-1}f`:'—'} · Stun ${f.remaining}f\n${f.moveId??'—'} · ${t('state.advantage')} ${advantage}\n${t('state.direction')} ${f.input.current.direction} · HP ${f.hp} · ${f.input.motions.join(' ')}`;
}
