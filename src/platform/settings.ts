import { ACTIONS, DEFAULT_CONTROLS, saveJson, validateControls, type Action, type Devices } from './devices';
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
  function draw(): void {
    panel.innerHTML = `<div class="settings">${devices.config.players.map((p, i) => `<div><strong>${t('settings.player',{player:i+1})}</strong><label>${t('settings.device')} <select data-device="${i}"><option value="">${t('settings.keyboard')}</option></select></label><label>${t('settings.assign')} <select id="mapping-mode-${i}"><option value="key">${t('settings.keyboard')}</option><option value="pad">${t('settings.gamepadButton')}</option></select></label><div class="mapping">${ACTIONS.map(action => `<button data-player="${i}" data-action="${action}" title="${t('settings.rebind')}">${action}<br>${p.keys[action].replace('Key','').replace('Arrow','').replace('Numpad','N')}</button>`).join('')}</div><label>Stick X / Y <input data-axis="horizontal" data-player="${i}" type="number" min="0" max="63" value="${p.axes.horizontal}" style="width:55px"><input data-axis="vertical" data-player="${i}" type="number" min="0" max="63" value="${p.axes.vertical}" style="width:55px"></label></div>`).join('')}</div>
      <div class="settings"><div><label>${t('settings.socdHorizontal')} <select id="socd-h"><option value="neutral">${t('settings.neutral')}</option><option value="lastInputWins">${t('settings.lastInput')}</option></select></label><label>${t('settings.socdVertical')} <select id="socd-v"><option value="positive">${t('settings.upWins')}</option><option value="neutral">${t('settings.neutral')}</option><option value="lastInputWins">${t('settings.lastInput')}</option></select></label></div><div><label>${t('settings.buffer')} <input id="buffer" type="number" min="1" max="30" value="${devices.config.bufferFrames}" style="width:65px"></label><div class="toolbar-group"><button id="export-controls">${t('settings.saveJson')}</button><button id="import-controls">${t('settings.loadJson')}</button><button id="default-controls">${t('settings.defaults')}</button></div></div></div><input id="controls-file" type="file" accept="application/json,.json" hidden>`;
    (panel.querySelector('#socd-h') as HTMLSelectElement).value = devices.config.socd.horizontal;
    (panel.querySelector('#socd-v') as HTMLSelectElement).value = devices.config.socd.vertical;
    mappingModes.forEach((mode,player)=>{
      const select=panel.querySelector<HTMLSelectElement>(`#mapping-mode-${player}`)!;
      select.value=mode;select.onchange=()=>{mappingModes[player]=select.value;drawMapping(player);};
      drawMapping(player);
    });
    panel.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => button.onclick = () => {
      const player = Number(button.dataset.player), action = button.dataset.action as Action;
      if ((panel.querySelector(`#mapping-mode-${player}`) as HTMLSelectElement).value === 'pad') {
        if(devices.config.players[player].gamepadIndex===null){message(t('message.selectGamepad'));return;}
        bindPad = { player, action, armed:false }; message(t('message.pressGamepad',{player:player+1,action}));
      } else {
        message(t('message.pressKey',{player:player+1,action}));
        devices.capture = code => { if (code !== 'Escape') { devices.config.players[player].keys[action] = code; commit(); } else message(t('message.bindingCancelled')); };
      }
    });
    panel.querySelectorAll<HTMLSelectElement>('[data-device]').forEach(select => select.onchange = () => {
      const player = Number(select.dataset.device), index = select.value === '' ? null : Number(select.value);
      if (index !== null && devices.config.players[1 - player].gamepadIndex === index) devices.config.players[1 - player].gamepadIndex = null;
      devices.config.players[player].gamepadIndex = index; commit();
    });
    panel.querySelectorAll<HTMLInputElement>('[data-axis]').forEach(input => input.onchange = () => {
      const number = Number(input.value);
      if (!Number.isInteger(number) || number < 0 || number > 63) { draw(); return; }
      devices.config.players[Number(input.dataset.player)].axes[input.dataset.axis as 'horizontal'] = number; commit();
    });
    panel.querySelector('#socd-h')!.addEventListener('change', event => { devices.config.socd.horizontal = (event.target as HTMLSelectElement).value as typeof devices.config.socd.horizontal; commit(); });
    panel.querySelector('#socd-v')!.addEventListener('change', event => { devices.config.socd.vertical = (event.target as HTMLSelectElement).value as typeof devices.config.socd.vertical; commit(); });
    panel.querySelector('#buffer')!.addEventListener('change', event => { const value = Number((event.target as HTMLInputElement).value); if (Number.isInteger(value) && value >= 1 && value <= 30) { devices.config.bufferFrames = value; commit(); } else draw(); });
    panel.querySelector('#export-controls')!.addEventListener('click', () => saveJson('stickman-controls.json', devices.config));
    const file = panel.querySelector<HTMLInputElement>('#controls-file')!;
    panel.querySelector('#import-controls')!.addEventListener('click', () => file.click());
    file.onchange = async () => { try { if (file.files?.[0]) { devices.config = validateControls(JSON.parse(await file.files[0].text())); commit(); } } catch (error) { message(String(error)); } };
    panel.querySelector('#default-controls')!.addEventListener('click', () => { devices.config = structuredClone(DEFAULT_CONTROLS); commit(); });
    previousPads = null;
  }
  function commit(): void { try { devices.persist(); changed(); draw(); message(t('message.bindingSaved')); } catch (error) { message(String(error)); } }
  window.addEventListener('keydown', event => { if (event.code === 'Escape') { bindPad = null; message(''); } });
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
        if (['up','down','left','right'].includes(bindPad.action)) mapping.padDirections[bindPad.action as 'up'] = index;
        else mapping.padButtons[bindPad.action as Button] = index;
        bindPad = null; commit();
      }
    }
  };
}
