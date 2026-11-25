import moves from '../data/moves.json';
import { t, type TranslationKey } from './i18n';

export const comboLabelKeys: Record<string, TranslationKey> = {
  revenge_combo: 'combo.revenge',
  special_spin: 'combo.specialSpin',
  tornado_spin_combo: 'combo.tornadoSpin',
  spin_high_middle_combo: 'combo.spinHighMiddle',
  middle_high_low_combo: 'combo.middleHighLow',
  middle_high_punch_combo: 'combo.middleHighPunch',
  punch_kick_combo: 'combo.punchKick',
  double_high_kick: 'combo.doubleHigh',
  kick_punch_combo: 'combo.kickPunch',
};
// Commands come from the move data; the order follows comboLabelKeys (full-bar
// moves, then forward combos, then back). Combos without a label yet follow at the end, by id.
const comboOrder=(id: string)=>{ const index=Object.keys(comboLabelKeys).indexOf(id); return index<0?Number.MAX_SAFE_INTEGER:index; };
export const comboMoves = moves.filter(move=>move.command.buttons.length>1).sort((a,b)=>
  comboOrder(a.id)-comboOrder(b.id) || (a.id<b.id?-1:a.id>b.id?1:0));
export function comboLabel(id: string): string {
  return comboLabelKeys[id]?t(comboLabelKeys[id]):id;
}
const tx=(key: TranslationKey)=>`data-i18n="${key}">${t(key)}`;
/** Full-bar moves (command.resource) explain their bar. */
const resourceHints: Record<string, TranslationKey> = { revenge: 'combo.revengeHint', special: 'combo.specialHint' };
const resourceHint=(command: { resource?: string })=>command.resource?`<p class="hint" ${tx(resourceHints[command.resource])}</p>`:'';
/** Throws (6/4 + THROW) for the move list; inputs come from the move data. */
export const throwLabelKeys: Record<string, TranslationKey> = { throw_forward: 'throw.forward', throw_back: 'throw.back' };
export const throwMoves = moves.filter(move=>(move as { throw?: { phase: string } }).throw?.phase==='attempt')
  .sort((a,b)=>b.command.directions[0]-a.command.directions[0]);

export const comboMarkup = `
<details id="combo-list">
  <summary ${tx('combo.summary')}</summary>
  <p class="hint" ${tx('combo.help')}</p>
  <ul class="combo-list">
    ${comboMoves.map(move=>`<li data-combo="${move.id}">
      <strong ${comboLabelKeys[move.id]?tx(comboLabelKeys[move.id]):`>${move.id}`}</strong>
      <div class="combo-command"><span ${tx(move.command.directions[0]===6?'combo.forward':'combo.back')}</span> + <span class="mono">${move.command.buttons.join(' + ')}</span></div>
      <div class="combo-bindings">${[0,1].map(player=>`<span>P${player+1}: ${move.command.buttons.map(button=>`<kbd data-owner="${player}" data-control="${button}">${button}</kbd>`).join(' + ')}</span>`).join('')}</div>
      ${resourceHint(move.command as { resource?: string })}
    </li>`).join('')}
  </ul>
  <strong class="combo-section" ${tx('combo.throws')}</strong>
  <p class="hint" ${tx('combo.throwsHelp')}</p>
  <ul class="combo-list throw-list">
    ${throwMoves.map(move=>`<li data-combo="${move.id}">
      <strong ${throwLabelKeys[move.id]?tx(throwLabelKeys[move.id]):`>${move.id}`}</strong>
      <div class="combo-command"><span ${tx(move.command.directions[0]===6?'combo.forward':'combo.back')}</span> + <span class="mono">THROW</span></div>
      <div class="combo-bindings">${[0,1].map(player=>`<span>P${player+1}: <kbd data-owner="${player}" data-control="THROW">THROW</kbd></span>`).join('')}</div>
    </li>`).join('')}
  </ul>
</details>`;
