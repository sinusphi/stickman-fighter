import { setupTheme, type Palette } from './platform/theme';
import './style.css';
import { createGame, snapshot, step } from './simulation/state';
import type { GameState } from './simulation/types';
import type { ControlEvent } from './simulation/events';
import { FixedLoop } from './platform/loop';
import { render } from './render/canvas';
import { HitFeedback } from './render/feedback';
import { setupAnimationPreview } from './debug/animation-preview';
import type { HitLevel } from './data/schema';
import { Devices, saveJson, type Action } from './platform/devices';
import { setupSettings } from './platform/settings';
import { setupStage } from './platform/stage';
import { STAGES, type StageId } from './render/stages';
import { markup } from './platform/markup';
import { inputLines, stateLine } from './debug/display';
import { createReplay, parseReplay, MAX_REPLAY_FRAMES, type Replay } from './debug/replay';
import type { DummyMode } from './debug/training';
import rules from './data/rules.json';
import { CpuPlayer } from './ai';
import { PROFILES, loadCpuSettings, saveCpuSettings, type Difficulty } from './ai/profiles';
import { neutralInput } from './input/types';

async function main(): Promise<void> {
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = markup;
  const element = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
  const button = (id: string): HTMLButtonElement => element<HTMLButtonElement>(id);
  const canvas = element<HTMLCanvasElement>('game');
  let palette: Palette;
  setupTheme(button('theme'),colors=>{palette=colors;});
  let stage: StageId;
  setupStage(document,selected=>{stage=selected;});
  const devices = new Devices();
  await devices.loadConfiguration();
  let game = createGame();
  game.inputConfig = { socd: structuredClone(devices.config.socd), bufferFrames: devices.config.bufferFrames };
  let previous = snapshot(game);
  // Accessing localStorage itself can throw when persistence is disabled.
  const storage = { getItem:(key:string)=>window.localStorage.getItem(key), setItem:(key:string,value:string)=>window.localStorage.setItem(key,value) };
  const cpuSettings = loadCpuSettings(storage);
  let cpus: [CpuPlayer,CpuPlayer] = [new CpuPlayer(cpuSettings.playerOneDifficulty,0),new CpuPlayer(cpuSettings.difficulty,1)];
  const matchSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
  const resetCpus = () => { cpus[0].reset(matchSeed());cpus[1].reset(matchSeed()); };
  resetCpus();
  const cpuLevelOne = element<HTMLSelectElement>('cpu-level-0');
  const cpuLevel = element<HTMLSelectElement>('cpu-level');
  cpuLevelOne.value = cpuSettings.playerOneDifficulty;
  cpuLevel.value = cpuSettings.difficulty;
  const feedback = new HitFeedback();
  const preview = setupAnimationPreview(()=>{devices.clear();setPaused(true);});
  const loop = new FixedLoop();
  let showBoxes = false, showInputs = false, showStates = false;
  let pendingEvents: ControlEvent[] = [];
  let recording: Replay | null = null;
  let lastReplay: Replay | null = null;
  let playback: { replay: Replay; index: number; returnState: GameState; returnKoFrames: number[]; returnLevels: (HitLevel | undefined)[] } | null = null;
  const message = (text: string) => { element('notice').textContent = text; };
  const dummyNames: Record<DummyMode,string> = { stand:'Stehen', crouch:'Hocken', block:'Immer blocken', cpu:'CPU' };
  let layout = new Map<string,string>();
  function refreshBindings(): void {
    const names:Record<string,string>={ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→',Space:'␣',ShiftLeft:'⇧',ShiftRight:'⇧',ControlLeft:'Ctrl',ControlRight:'Ctrl'};
    document.querySelectorAll<HTMLElement>('[data-control]').forEach(key=>{
      const code=devices.config.players[Number(key.dataset.owner)].keys[key.dataset.control as Action];
      key.title=code;key.textContent=names[code]??layout.get(code)?.toUpperCase()??code.replace('Key','').replace('Digit','').replace('Numpad','N').slice(0,5);
    });
  }
  const keyboard=(navigator as Navigator & {keyboard?:{getLayoutMap:()=>Promise<Map<string,string>>}}).keyboard;
  keyboard?.getLayoutMap().then(map=>{layout=map;refreshBindings();}).catch(()=>{});
  refreshBindings();

  function setPaused(paused: boolean): void { loop.paused = paused; loop.reset(); previous = snapshot(game); }
  function stopPlayback(): void {
    if (!playback) return;
    game = playback.returnState; feedback.levels=[...playback.returnLevels]; feedback.koFrames=[...playback.returnKoFrames]; previous = snapshot(game); playback = null;
    devices.clear(); setPaused(true); message('Zurück im lokalen Spiel. Mit P fortsetzen.');
  }
  function runFrame(): void {
    previous = snapshot(game);
    if (playback) {
      const entry = playback.replay.frames[playback.index];
      if (!entry) { setPaused(true); return; }
      step(game,entry.inputs,entry.events);
      if(entry.events.some(e=>e.type==='reset'||e.type==='training'))feedback.reset(game);
      feedback.update(game,previous);playback.index++;
      if (playback.index === playback.replay.frames.length) { setPaused(true); message('Replay beendet. F7 kehrt zum lokalen Spiel zurück; P spielt es erneut ab.'); }
    } else {
      const inputs = devices.sample(), events = pendingEvents; pendingEvents = [];
      const restarting = events.some(e=>e.type==='reset'||e.type==='training');
      if (restarting) resetCpus();
      const trainingCpu = game.training.enabled && game.training.dummy === 'cpu';
      const demoActive = cpuSettings.demo && !game.training.enabled;
      const cpuControlsOpponent = trainingCpu || (!game.training.enabled && cpuSettings.enabled) || demoActive;
      if (demoActive) inputs[0] = restarting ? neutralInput() : cpus[0].next(game);
      if (cpuControlsOpponent) inputs[1] = restarting ? neutralInput() : cpus[1].next(game);
      else if ((cpuSettings.enabled || cpuSettings.demo) && game.training.enabled) inputs[1] = neutralInput();
      if (recording) {
        recording.frames.push(structuredClone({ inputs,events }));
        if (recording.frames.length >= MAX_REPLAY_FRAMES) { lastReplay=recording; recording=null; message('Aufnahme nach 30 Minuten beendet. Replay kann gespeichert werden.'); }
      }
      step(game,inputs,events);
      if(events.some(e=>e.type==='reset'||e.type==='training'))feedback.reset(game);
      feedback.update(game,previous);
      if (events.some(e=>e.type==='reset'||e.type==='training')) previous=snapshot(game);
    }
    if (previous.round.phase !== 'fighting' && game.round.phase === 'fighting') { previous = snapshot(game);feedback.reset(game); }
  }
  function queue(event: ControlEvent): void {
    if (playback) stopPlayback();
    pendingEvents.push(event);
    if (loop.paused) { runFrame(); previous=snapshot(game); }
  }
  function togglePause(): void {
    if (playback && playback.index === playback.replay.frames.length) { game=snapshot(playback.replay.initial); feedback.reset(game);playback.index=0; }
    setPaused(!loop.paused);
  }
  function reset(): void { devices.clear(); queue({type:'reset'}); loop.reset(); }
  function changeCpu(player: 0 | 1, difficulty: Difficulty): void {
    if (playback || (game.training.enabled && game.training.dummy !== 'cpu')) return;
    if(player===0)cpuSettings.playerOneDifficulty=difficulty;else cpuSettings.difficulty=difficulty;
    cpus[player]=new CpuPlayer(difficulty,player);saveCpuSettings(storage,cpuSettings);reset();
  }
  function toggleCpu(): void {
    if (playback || game.training.enabled) return;
    cpuSettings.enabled=!cpuSettings.enabled;cpuSettings.demo=false;saveCpuSettings(storage,cpuSettings);reset();
  }
  function toggleDemo(): void {
    if (playback || game.training.enabled) return;
    cpuSettings.demo=!cpuSettings.demo;cpuSettings.enabled=false;saveCpuSettings(storage,cpuSettings);reset();
  }
  cpuLevelOne.onchange=()=>{changeCpu(0,cpuLevelOne.value as Difficulty);updateUI();};
  cpuLevel.onchange=()=>{changeCpu(1,cpuLevel.value as Difficulty);updateUI();};
  function toggleTraining(): void { queue({type:'training',enabled:!game.training.enabled,dummy:game.training.dummy}); }
  function changeDummy(): void {
    if (!game.training.enabled) return;
    const modes: DummyMode[]=['stand','crouch','block','cpu'];
    queue({type:'training',enabled:true,dummy:modes[(modes.indexOf(game.training.dummy)+1)%modes.length]});
  }
  function toggleRecord(): void {
    if (playback) stopPlayback();
    if (recording) { lastReplay=recording; recording=null; message(`Aufnahme gespeichert: ${lastReplay.frames.length} Frames. Mit F7 abspielen oder als Datei speichern.`); }
    else { recording=createReplay(game); message('Aufnahme läuft. F6 beendet sie.'); }
  }
  function toggleReplay(): void {
    if (playback) { stopPlayback(); return; }
    if (recording) { lastReplay=recording; recording=null; }
    if (!lastReplay?.frames.length) { message('Zuerst eine Aufnahme erstellen oder eine Replay-Datei laden.'); return; }
    playback={replay:parseReplay(lastReplay),index:0,returnState:snapshot(game),returnKoFrames:[...feedback.koFrames],returnLevels:[...feedback.levels]};
    game=snapshot(playback.replay.initial); feedback.reset(game);previous=snapshot(game); pendingEvents=[]; devices.clear(); setPaused(false);
    message('Replay läuft. F7 kehrt zum lokalen Spiel zurück.');
  }
  function singleStep(): void { if(loop.paused) { runFrame(); previous=snapshot(game); } }
  const actions: Record<string,()=>void> = {
    pause:togglePause, step:singleStep, reset,
    boxes:()=>showBoxes=!showBoxes, inputs:()=>showInputs=!showInputs, states:()=>showStates=!showStates,
    training:toggleTraining, dummy:changeDummy, record:toggleRecord, play:toggleReplay,
    cpu:toggleCpu, demo:toggleDemo,
  };
  for (const [id,action] of Object.entries(actions)) button(id).onclick=()=>{ action(); updateUI(); };
  button('export-replay').onclick=()=>{ const replay=recording??lastReplay; if(replay)saveJson('stickman-replay.json',replay); };
  button('import-replay').onclick=()=>{ setPaused(true); element<HTMLInputElement>('replay-file').click(); };
  element<HTMLInputElement>('replay-file').onchange=async event=>{
    const input=event.target as HTMLInputElement;
    try {
      const file=input.files?.[0]; if(!file)return;
      if(file.size>64*1024*1024)throw Error('Replay-Datei darf höchstens 64 MB groß sein.');
      const imported=parseReplay(JSON.parse(await file.text()));
      if(playback)stopPlayback();
      if(recording){recording=null;}
      lastReplay=imported;message(`Replay geladen: ${imported.frames.length} Frames. F7 startet die Wiedergabe.`);
    } catch(error) { message(String(error)); }
    finally { input.value='';updateUI(); }
  };
  const pollSettings=setupSettings(devices,()=>{refreshBindings();queue({type:'inputConfig',config:{socd:structuredClone(devices.config.socd),bufferFrames:devices.config.bufferFrames}});},message);
  element('settings-details').addEventListener('toggle',event=>{ if((event.target as HTMLDetailsElement).open)setPaused(true); });
  document.addEventListener('click',event=>{ if((event as MouseEvent).detail>0 && (event.target as HTMLElement).closest('button'))(document.activeElement as HTMLElement)?.blur(); });
  const hotkeys: Record<string,string> = { KeyP:'pause',Period:'step',Backspace:'reset',F1:'boxes',F2:'inputs',F3:'states',F4:'training',F5:'dummy',F6:'record',F7:'play',F8:'cpu',F9:'demo' };
  window.addEventListener('keydown',event=>{
    if((event.target as HTMLElement).closest('#animation-preview'))return;
    if(event.repeat || devices.capture || (event.target as HTMLElement).matches('input,select,textarea'))return;
    if(devices.config.players.some(p=>Object.values(p.keys).includes(event.code)))return;
    const action=hotkeys[event.code];if(action){event.preventDefault();actions[action]();updateUI();}
  });
  window.addEventListener('blur',()=>{devices.clear();setPaused(true);message('Spiel pausiert, weil das Fenster den Fokus verloren hat. Mit P fortsetzen.');});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){devices.clear();setPaused(true);}});
  window.addEventListener('gamepaddisconnected',()=>{devices.clear();setPaused(true);message('Controller getrennt. Verbindung prüfen und mit P fortsetzen.');});

  function updateUI(): void {
    const trainingCpu=game.training.enabled && game.training.dummy==='cpu';
    const cpuActive=cpuSettings.enabled && !game.training.enabled && !playback;
    const demoActive=cpuSettings.demo && !game.training.enabled && !playback;
    const cpuPresent=cpuActive || trainingCpu || demoActive;
    button('cpu').disabled=game.training.enabled || !!playback;
    button('demo').disabled=game.training.enabled || !!playback;
    cpuLevelOne.disabled=!!playback || game.training.enabled;
    cpuLevel.disabled=!!playback || (game.training.enabled && !trainingCpu);
    button('cpu').setAttribute('aria-pressed',String(cpuActive || trainingCpu));
    button('demo').setAttribute('aria-pressed',String(demoActive));
    button('cpu').textContent=trainingCpu?'CPU: Trainingsdummy':game.training.enabled?'CPU: Training hat Vorrang':playback?'CPU: Replay hat Vorrang':`CPU: ${cpuActive?'An':'Aus'} · F8`;
    button('demo').textContent=game.training.enabled?'Demo: Training hat Vorrang':playback?'Demo: Replay hat Vorrang':`Demo: ${demoActive?'An':'Aus'} · F9`;
    element('p1-label').textContent=demoActive?'CPU 01':'PLAYER 01';
    element('p2-label').textContent=demoActive?'CPU 02':cpuPresent?'CPU':'PLAYER 02';
    const demoLevels=`${PROFILES[cpuSettings.playerOneDifficulty].label.toUpperCase()} VS ${PROFILES[cpuSettings.difficulty].label.toUpperCase()}`;
    element('match-status').textContent=`${playback?'REPLAY':trainingCpu?'TRAINING · CPU · '+PROFILES[cpuSettings.difficulty].label.toUpperCase():game.training.enabled?'TRAINING':demoActive?'DEMO · '+demoLevels:cpuActive?'VS CPU · '+PROFILES[cpuSettings.difficulty].label.toUpperCase():'LOCAL VERSUS'} · ${rules.hz} HZ`;
    element('cpu-debug').hidden=!cpuPresent;
    element('cpu-debug').textContent=demoActive
      ? cpus.map((cpu,i)=>`CPU ${i+1}: ${cpu.debug.reason}${cpu.debug.kind==='attack'?' '+cpu.debug.moveId:''} (${cpu.debug.score.toFixed(2)})`).join('\n')
      : cpuPresent?`CPU 2: ${cpus[1].debug.reason}${cpus[1].debug.kind==='attack'?' '+cpus[1].debug.moveId:''} (${cpus[1].debug.score.toFixed(2)})`:'';
    button('pause').textContent=loop.paused?'Weiter · P':'Pause · P';
    button('step').disabled=!loop.paused;
    button('boxes').setAttribute('aria-pressed',String(showBoxes));
    button('inputs').setAttribute('aria-pressed',String(showInputs));
    button('states').setAttribute('aria-pressed',String(showStates));
    button('training').setAttribute('aria-pressed',String(game.training.enabled));
    button('dummy').disabled=!game.training.enabled;
    button('dummy').textContent=`Dummy: ${dummyNames[game.training.dummy]} · F5`;
    button('record').textContent=recording?'■ Aufnahme stoppen · F6':'● Aufnahme · F6';
    button('record').setAttribute('aria-pressed',String(!!recording));
    button('play').disabled=!playback&&!lastReplay?.frames.length&&!recording?.frames.length;
    button('play').textContent=playback?'Replay verlassen · F7':'Replay · F7';
    button('export-replay').disabled=!(recording??lastReplay)?.frames.length;
    element('debug').hidden=!showStates; element('input-history').hidden=!showInputs;
    for(const f of game.fighters) {
      for(const name of ['revenge','special'] as const) {
        const resource=f.resources[name], track=element(`resource-${f.id}-${name}`);
        element(`resource-value-${f.id}-${name}`).textContent=`${resource.current} / ${resource.max}`;
        track.setAttribute('aria-valuenow',String(resource.current));track.setAttribute('aria-valuemax',String(resource.max));
        (track.firstElementChild as HTMLElement).style.width=`${resource.current/resource.max*100}%`;
      }
      element(`hp-${f.id}`).textContent=`${f.hp} / ${rules.maxHealth}`;
      const bar=element(`health-${f.id}`);bar.style.width=`${f.hp/rules.maxHealth*100}%`;bar.parentElement!.setAttribute('aria-valuenow',String(f.hp));
      element(`wins-${f.id}`).innerHTML=Array.from({length:rules.winsRequired},(_,i)=>`<span class="${game.round.wins[f.id]>i?'won':''}"></span>`).join('');
      element(`state-${f.id}`).textContent=`${stateLine(f)}\nInputframe ${game.frame} · Kampfframe ${game.combatFrame} · Hitstop ${game.hitstop}f`;
      if(showInputs)element(`input-${f.id}`).textContent=inputLines(f);
    }
    element('timer').textContent=game.training.enabled?'∞':String(Math.ceil(game.round.timer/rules.hz)).padStart(2,'0');
    element('round-label').textContent=game.training.enabled?'TRAINING':`ROUND ${String(game.round.number).padStart(2,'0')}`;
    element('arena-mode').textContent=playback?`REPLAY / ${playback.index} : ${playback.replay.frames.length}`:recording?`REC / ${recording.frames.length} FRAMES`:trainingCpu?`TRAINING / CPU · ${PROFILES[cpuSettings.difficulty].label.toUpperCase()}`:game.training.enabled?`TRAINING / ${dummyNames[game.training.dummy].toUpperCase()}`:demoActive?`${STAGES[stage].caption} / CPU-DEMO · ${demoLevels}`:cpuActive?`${STAGES[stage].caption} / VS CPU · ${PROFILES[cpuSettings.difficulty].label.toUpperCase()}`:`${STAGES[stage].caption} / LOCAL 1V1`;
    canvas.dataset.frame=String(game.frame);canvas.dataset.ready='true';
  }
  function frame(time: number): void {
    const alpha=loop.advance(time,runFrame);
    render(canvas,game,previous,loop.paused?1:alpha,loop.paused,showBoxes,palette,feedback.levels,feedback.koFrames,stage);
    preview(time,palette);
    pollSettings();updateUI();requestAnimationFrame(frame);
  }
  updateUI();requestAnimationFrame(frame);
}

void main().catch(error=>{document.querySelector('#app')!.textContent=`Spiel konnte nicht starten: ${String(error)}`;});
