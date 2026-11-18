import { ACTIONS, DEFAULT_CONTROLS, saveJson, validateControls, type Action, type Controls, type Devices } from './devices';
import { type Button } from '../input/types';
import { onLanguageChange, t } from './i18n';

export function setupSettings(devices: Devices, changed: () => void, message: (text: string) => void): () => void {
  const panel = document.querySelector<HTMLElement>('#settings')!;
  let bindPad: { player: number; action: Action; armed: boolean } | null = null;
  const mappingModes = ['key','key'];
  let previousPads: string | null = null;
  function drawMapping(player: number): void {
    const profile=devices.config.players[player];
    panel.querySelectorAll<HTMLButtonElement>(`[data-player="${player}"][data-action]`).forEach(button=>{
      const action=button.dataset.action as Action;
      const code=mappingModes[player]==='key'?profile.keys[action].replace('Key','').replace('Numpad','N'):`B${['up','down','left','right'].includes(action)?profile.padDirections[action as 'up']:profile.padButtons[action as Button]}`;
      button.innerHTML=`${t(`action.${action}` as Parameters<typeof t>[0])}<br>${code==='B-1'?'—':code}`;
    });
  }
  const keyLabel = (code: string) => code.replace('Key','').replace('Arrow','').replace('Numpad','N');
  function playerSettings(): string {
    return `<div class="settings">${devices.config.players.map((p, i) => [
      `<div><strong>${t('settings.player',{player:i+1})}</strong>`,
      `<label><input type="checkbox" data-auto-block="${i}" ${p.autoBlock ? 'checked' : ''}> ${t('settings.autoBlock')}</label>`,
      `<label>${t('settings.device')} <select data-device="${i}"><option value="">${t('settings.keyboard')}</option></select></label>`,
      `<label>${t('settings.assign')} <select id="mapping-mode-${i}"><option value="key">${t('settings.keyboard')}</option><option value="pad">${t('settings.gamepadButton')}</option></select></label>`,
      `<div class="mapping">${ACTIONS.map(action => `<button data-player="${i}" data-action="${action}" title="${t('settings.rebind')}">${action}<br>${keyLabel(p.keys[action])}</button>`).join('')}</div>`,
      `<label>Stick X / Y <input data-axis="horizontal" data-player="${i}" type="number" min="0" max="63" value="${p.axes.horizontal}" style="width:55px">`,
      `<input data-axis="vertical" data-player="${i}" type="number" min="0" max="63" value="${p.axes.vertical}" style="width:55px"></label></div>`,
    ].join('')).join('')}</div>`;
  }
  function generalSettings(): string {
    return [
      `<div class="settings"><div>`,
      `<label>${t('settings.socdHorizontal')} <select id="socd-h"><option value="neutral">${t('settings.neutral')}</option><option value="lastInputWins">${t('settings.lastInput')}</option></select></label>`,
      `<label>${t('settings.socdVertical')} <select id="socd-v"><option value="positive">${t('settings.upWins')}</option><option value="neutral">${t('settings.neutral')}</option><option value="lastInputWins">${t('settings.lastInput')}</option></select></label>`,
      `</div><div>`,
      `<label>${t('settings.buffer')} <input id="buffer" type="number" min="1" max="30" value="${devices.config.bufferFrames}" style="width:65px"></label>`,
      `<div class="toolbar-group"><button id="export-controls">${t('settings.saveJson')}</button><button id="import-controls">${t('settings.loadJson')}</button><button id="default-controls">${t('settings.defaults')}</button></div>`,
      `</div></div>`,
    ].join('');
  }
  function draw(): void {
    panel.innerHTML = playerSettings() + '\n      ' + generalSettings() + '<input id="controls-file" type="file" accept="application/json,.json" hidden>';
    (panel.querySelector('#socd-h') as HTMLSelectElement).value = devices.config.socd.horizontal;
    (panel.querySelector('#socd-v') as HTMLSelectElement).value = devices.config.socd.vertical;
    mappingModes.forEach((mode,player)=>{
      const select=panel.querySelector<HTMLSelectElement>(`#mapping-mode-${player}`)!;
      select.value=mode;select.onchange=()=>{mappingModes[player]=select.value;cancelPendingBindings();drawMapping(player);};
      drawMapping(player);
    });
    panel.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => button.onclick = () => {
      const player = Number(button.dataset.player), action = button.dataset.action as Action;
      if ((panel.querySelector(`#mapping-mode-${player}`) as HTMLSelectElement).value === 'pad') {
        if(devices.config.players[player].gamepadIndex===null){message(t('message.selectGamepad'));return;}
        cancelPendingBindings(); bindPad = { player, action, armed:false }; message(t('message.pressGamepad',{player:player+1,action}));
      } else {
        cancelPendingBindings(); message(t('message.pressKey',{player:player+1,action}));
        devices.capture = code => { if (code !== 'Escape') commit(draft => { draft.players[player].keys[action] = code; }); else message(t('message.bindingCancelled')); };
      }
    });
    panel.querySelectorAll<HTMLInputElement>('[data-auto-block]').forEach(input => input.onchange = () => {
      commit(draft => { draft.players[Number(input.dataset.autoBlock)].autoBlock = input.checked; });
    });
    panel.querySelectorAll<HTMLSelectElement>('[data-device]').forEach(select => select.onchange = () => {
      const player = Number(select.dataset.device), index = select.value === '' ? null : Number(select.value);
      commit(draft => {
        if (index !== null && draft.players[1 - player].gamepadIndex === index) draft.players[1 - player].gamepadIndex = null;
        draft.players[player].gamepadIndex = index;
      });
    });
    panel.querySelectorAll<HTMLInputElement>('[data-axis]').forEach(input => input.onchange = () => {
      const number = Number(input.value);
      if (!Number.isInteger(number) || number < 0 || number > 63) { draw(); return; }
      commit(draft => { draft.players[Number(input.dataset.player)].axes[input.dataset.axis as 'horizontal'] = number; });
    });
    panel.querySelector('#socd-h')!.addEventListener('change', event => { const value = (event.target as HTMLSelectElement).value as Controls['socd']['horizontal']; commit(draft => { draft.socd.horizontal = value; }); });
    panel.querySelector('#socd-v')!.addEventListener('change', event => { const value = (event.target as HTMLSelectElement).value as Controls['socd']['vertical']; commit(draft => { draft.socd.vertical = value; }); });
    panel.querySelector('#buffer')!.addEventListener('change', event => { const value = Number((event.target as HTMLInputElement).value); if (Number.isInteger(value) && value >= 1 && value <= 30) commit(draft => { draft.bufferFrames = value; }); else draw(); });
    panel.querySelector('#export-controls')!.addEventListener('click', () => saveJson('stickman-controls.json', devices.config));
    const file = panel.querySelector<HTMLInputElement>('#controls-file')!;
    panel.querySelector('#import-controls')!.addEventListener('click', () => file.click());
    file.onchange = async () => {
      const selected = file.files?.[0]; file.value = '';
      if (!selected) return;
      try { const imported = validateControls(JSON.parse(await selected.text())); commit(() => imported); } catch (error) { message(String(error)); }
    };
    panel.querySelector('#default-controls')!.addEventListener('click', () => commit(() => structuredClone(DEFAULT_CONTROLS)));
    previousPads = null;
  }
  function cancelPendingBindings(): void { bindPad = null; devices.capture = null; }
  /**
   * Applies a change atomically: the mutation runs on a copy, invalid results
   * leave the active controls untouched, and a valid result is always applied
   * to devices, simulation and UI together, even if it cannot be stored.
   */
  function commit(mutate: (draft: Controls) => Controls | undefined): void {
    cancelPendingBindings();
    const draft = structuredClone(devices.config);
    let result: { saved: boolean };
    try { result = devices.apply(mutate(draft) ?? draft); }
    catch (error) { draw(); message(String(error)); return; }
    changed(); draw();
    message(t(result.saved ? 'message.bindingSaved' : 'message.bindingSessionOnly'));
  }
  window.addEventListener('keydown', event => { if (event.code === 'Escape') { bindPad = null; message(''); } });
  document.querySelector<HTMLButtonElement>('#auto-block')!.onclick = () => {
    const enabled = !devices.config.players.every(player => player.autoBlock === true);
    commit(draft => { for (const player of draft.players) player.autoBlock = enabled; });
  };
  draw();
  onLanguageChange(draw);
  return () => {
    const pads = Array.from(navigator.getGamepads?.() ?? []);
    const signature = pads.map(p => p ? `${p.index}:${p.id}` : '').join('|');
    if (signature !== previousPads) {
      previousPads = signature;
      panel.querySelectorAll<HTMLSelectElement>('[data-device]').forEach(select => {
        select.querySelectorAll('[data-pad]').forEach(option => option.remove());
        for (const pad of pads) if (pad) { const option = new Option(`${pad.index + 1}: ${pad.id.slice(0,45)}`, String(pad.index)); option.dataset.pad = 'true'; select.add(option); }
        select.value = String(devices.config.players[Number(select.dataset.device)].gamepadIndex ?? '');
      });
    }
    if (bindPad) {
      const mapping = devices.config.players[bindPad.player];
      const pad = mapping.gamepadIndex === null ? null : pads[mapping.gamepadIndex];
      const index = pad?.buttons.findIndex(button => button.pressed) ?? -1;
      if(index<0)bindPad.armed=true;
      if (index >= 0 && bindPad.armed) {
        const { player, action } = bindPad;
        commit(draft => {
          if (['up','down','left','right'].includes(action)) draft.players[player].padDirections[action as 'up'] = index;
          else draft.players[player].padButtons[action as Button] = index;
        });
      }
    }
  };
}
