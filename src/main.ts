import { setupTheme, type Palette } from './platform/theme';
import './style.css';
import { createGame, snapshot, step } from './simulation/state';
import type { GameState } from './simulation/types';
import type { ControlEvent } from './simulation/events';
import { FixedLoop } from './platform/loop';
import { KoSlowMotion } from './platform/slow-motion';
import { render, fitCanvas } from './render/canvas';
import { HitFeedback } from './render/feedback';
import { HitEffects } from './render/effects';
import { loadEffectSettings } from './platform/effects-settings';
import { HitAudio } from './platform/audio';
import { describeStrike, newContactSounds, newResourceStarts, newSwingSounds, newThrowSounds, panOf } from './platform/hit-sound';
import { newResourceFills } from './platform/resource-ready';
import { newAnnouncerCues } from './platform/announcer';
import { setupAnimationPreview } from './debug/animation-preview';
import type { HitLevel } from './data/schema';
import { Devices, saveJson, type Action } from './platform/devices';
import { setupSettings } from './platform/settings';
import { setupStage } from './platform/stage';
import { STAGES, type StageId } from './render/stages';
import { markup } from './platform/markup';
import { createReplay, parseReplay, MAX_REPLAY_FRAMES, type Replay } from './debug/replay';
import type { DummyMode } from './debug/training';
import { Hud } from './platform/hud';
import rules from './data/rules.json';
import { CpuPlayer } from './ai';
import { loadCpuSettings, saveCpuSettings, type Difficulty } from './ai/profiles';
import { neutralInput, type RawInput } from './input/types';
import { onLanguageChange, setupLanguageSwitch, t, translateDocument } from './platform/i18n';
import { SurvivalSession, loadBest, saveBest } from './survival/session';
import { formatSurvival, inFront, snapshotSurvival, type SurvivalState } from './survival/state';
import { survivalFocus, survivalHudGame, survivalViews, type SurvivalView } from './survival/views';
import { renderSurvival } from './render/survival';
import { survivalTestConfig } from './survival/config';
import { playerMaxHp } from './survival/upgrades';
import { UpgradeChoice } from './platform/upgrade-choice';

/** Upper bound for replay files read into memory (see message.replayTooLarge). */
const MAX_REPLAY_FILE_BYTES = 64 * 1024 * 1024;

async function main(): Promise<void> {
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = markup;
  const element = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
  const button = (id: string): HTMLButtonElement => element<HTMLButtonElement>(id);
  const canvas = element<HTMLCanvasElement>('game');
  setupLanguageSwitch(button('language'));
  translateDocument();
  let palette: Palette;
  setupTheme(button('theme'),colors=>{palette=colors;});
  let stage: StageId;
  setupStage(document,selected=>{stage=selected;});
  const devices = new Devices();
  await devices.loadConfiguration();
  // Versus rounds open with the intro; `?intro=off` skips it (browser smokes of other features).
  const versusIntro = new URLSearchParams(location.search).get('intro') !== 'off';
  let game = createGame({ intro: versusIntro });
  game.inputConfig = { socd: structuredClone(devices.config.socd), bufferFrames: devices.config.bufferFrames, autoBlock: devices.config.players.map(p=>p.autoBlock === true) as [boolean,boolean] };
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
  // Survival mode (F10): its own session; versus state stays untouched meanwhile.
  let survival: SurvivalSession | null = null;
  let survivalPrevious: SurvivalState | null = null;
  let survivalBest = loadBest(storage);
  // Controls slot the survival player uses (P1 or P2 keys/pad), fixed per run from the side setting.
  let survivalSide: 0 | 1 = 0;
  // Upgrade choice after a boss: menu input of the survival player (presentation side).
  const upgradeChoice = new UpgradeChoice();
  // `?survival-test=weak-boss` (smoke tests): early miniboss with 1 hp.
  const survivalRules = survivalTestConfig(location.search);
  // The survival player is fighter 0 internally; it gets the auto block of its controls slot.
  const survivalConfig = (config: GameState['inputConfig']): GameState['inputConfig'] =>
    ({ ...structuredClone(config), autoBlock: [config.autoBlock?.[survivalSide] ?? false, false] });
  const feedback = new HitFeedback();
  // Presentation only: sparks, shake, dust and the combo counter follow the game states.
  const effects = new HitEffects(loadEffectSettings());
  const audio = new HitAudio();
  audio.preloadAnnouncer();
  for (const event of ['keydown', 'pointerdown', 'touchstart']) {
    window.addEventListener(event, () => audio.unlock(), { capture: true, passive: true });
  }
  // Presentation only: whooshes for every strike (whiffs included), then hits/blocks of this step.
  const playContactSound = () => {
    for (const cue of newAnnouncerCues(game, previous)) audio.playAnnouncer(cue);
    for (const swing of newSwingSounds(game, previous)) audio.playSwing(swing);
    for (const contact of newContactSounds(game, previous)) audio.playContact(contact);
    const throws = newThrowSounds(game, previous);
    for (const grab of throws.grabs) audio.playGrab(grab);
    for (const flight of throws.flights) audio.playSwing(flight);
    for (const slam of throws.slams) audio.playContact(slam);
    for (const fill of newResourceFills(game, previous)) audio.playResourceReady(fill.resource, panOf(game.fighters[fill.fighter].x), fill.delay / rules.hz);
    for (const start of newResourceStarts(game, previous)) audio.playResourceStart(start.resource, start.pan);
  };
  const preview = setupAnimationPreview(()=>{devices.clear();setPaused(true);});
  const loop = new FixedLoop();
  const slowMotion = new KoSlowMotion();
  let showBoxes = false, showInputs = false, showStates = false;
  let pendingEvents: ControlEvent[] = [];
  // Demo mode plays match after match: matchOver auto-restarts instead of waiting for Backspace.
  const DEMO_MATCH_HOLD = rules.hz * 3;
  let demoMatchOverFrames = 0;
  let recording: Replay | null = null;
  let lastReplay: Replay | null = null;
  let playback: { replay: Replay; index: number; returnState: GameState; returnKoFrames: number[]; returnRelaxFrames: number[]; returnLevels: (HitLevel | undefined)[] } | null = null;
  const message = (text: string) => { element('notice').textContent = text; };
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

  function setPaused(paused: boolean): void { loop.paused = paused; loop.reset(); previous = snapshot(game); if (survival) survivalPrevious = snapshotSurvival(survival.state); }
  const views = (state: SurvivalState): SurvivalView[] => survivalViews(state);
  function runSurvivalFrame(session: SurvivalSession): void {
    const before = snapshotSurvival(session.state);
    survivalPrevious = before;
    const inputs = devices.sample(), events = pendingEvents; pendingEvents = [];
    for (const event of events) if (event.type === 'inputConfig') { game.inputConfig = structuredClone(event.config); session.setInputConfig(survivalConfig(event.config)); }
    if (events.some(e => e.type === 'reset')) {
      session.reset(matchSeed(), survivalConfig(game.inputConfig)); survivalPrevious = snapshotSurvival(session.state); effects.reset(); upgradeChoice.reset(); return;
    }
    // Upgrade choice: the run stands still; the player's controls move the cursor and pick.
    const offer = session.state.upgrades.offer, pick = upgradeChoice.update(inputs[survivalSide], offer?.length ?? 0);
    if (pick !== null) pickUpgrade(pick, inputs[survivalSide]);
    if (session.choosing) return;
    const wasOver = session.state.over;
    session.step(upgradeChoice.filter(inputs[survivalSide]));
    const now = views(session.state), then = views(before);
    effects.updateCrowd(now, then, !loop.paused);
    // Sounds per [player, enemy] view; the player's own swings only once.
    now.forEach((view, index) => {
      const old = then.find(v => v.uid === view.uid)?.game;
      if (!old) return;
      const swingView = index === 0 ? view.game : { ...view.game, fighters: [old.fighters[0], view.game.fighters[1]] as GameState['fighters'] };
      for (const swing of newSwingSounds(swingView, old)) audio.playSwing(swing);
      for (const contact of newContactSounds(view.game, old)) audio.playContact(contact);
      const throws = newThrowSounds(view.game, old);
      for (const grab of throws.grabs) audio.playGrab(grab);
      for (const flight of throws.flights) audio.playSwing(flight);
      for (const slam of throws.slams) audio.playContact(slam);
      // The player is fighter 0 of every view: its full-bar start (Revenge, Wirbel) sounds once.
      if (index === 0) for (const start of newResourceStarts(swingView, old)) if (start.fighter === 0) audio.playResourceStart(start.resource, start.pan);
    });
    // A miniboss shook off a throw: muted sparks and the dull blocked-throw thud.
    const shrug = session.state.shrug;
    if (shrug.count !== before.shrug.count) {
      const boss = session.state.enemies.find(e => e.uid === shrug.uid), p = session.state.player;
      if (boss) {
        effects.spawnShrug(boss.fighter.x, Math.sign(boss.fighter.x - p.x) || p.facing);
        audio.playBlock(describeStrike(p.moveId ?? 'throw_forward', undefined, boss.fighter.x));
      }
    }
    if (!wasOver && session.state.over && session.state.survivedFrames > survivalBest) {
      survivalBest = session.state.survivedFrames; saveBest(storage, survivalBest);
    }
    loop.timeScale = 1;
  }
  /** Takes upgrade card `index` of the open choice (digit key or menu input). */
  function pickUpgrade(index: number, held: RawInput | null): void {
    const id = survival?.choose(index);
    if (!id) return;
    upgradeChoice.picked(held);
    message(t('message.upgradePicked', { name: t(`upgrade.${id}.name`) }));
  }
  function toggleSurvival(): void {
    if (playback || game.training.enabled) return;
    if (recording) { lastReplay = recording; recording = null; }
    devices.clear(); effects.reset(); loop.timeScale = 1; upgradeChoice.reset();
    if (survival) {
      survival = null; survivalPrevious = null;
      queue({ type: 'reset' }); message(t('message.survivalLeft'));
    } else {
      survivalSide = cpuSettings.humanSide;
      survival = new SurvivalSession(matchSeed(), survivalConfig(game.inputConfig), survivalRules);
      survivalPrevious = snapshotSurvival(survival.state);
      message(t('message.survivalStarted'));
    }
    loop.reset();
  }
  function stopPlayback(): void {
    if (!playback) return;
    game = playback.returnState; feedback.levels=[...playback.returnLevels]; feedback.koFrames=[...playback.returnKoFrames]; feedback.relaxFrames=[...playback.returnRelaxFrames]; previous = snapshot(game); playback = null; slowMotion.reset(); effects.reset(); loop.timeScale=1;
    devices.clear(); setPaused(true); message(t('message.localReturn'));
  }
  function runFrame(): void {
    if (survival) { runSurvivalFrame(survival); return; }
    previous = snapshot(game);
    if (playback) {
      const entry = playback.replay.frames[playback.index];
      if (!entry) { setPaused(true); return; }
      step(game,entry.inputs,entry.events);
      const restarted=entry.events.some(e=>e.type==='reset'||e.type==='training');
      if(restarted)feedback.reset(game);
      feedback.update(game,previous);
      if(restarted)effects.reset(); else effects.update(game,previous,!loop.paused);
      playContactSound();playback.index++;
      if (playback.index === playback.replay.frames.length) { setPaused(true); effects.reset(); message(t('message.replayEnded')); }
    } else {
      const inputs = devices.sample(), events = pendingEvents; pendingEvents = [];
      const restarting = events.some(e=>e.type==='reset'||e.type==='training');
      if (restarting) resetCpus();
      const trainingCpu = game.training.enabled && game.training.dummy === 'cpu';
      const demoActive = cpuSettings.demo && !game.training.enabled;
      const cpuControlsOpponent = trainingCpu || (!game.training.enabled && cpuSettings.enabled) || demoActive;
      // VS CPU as P2: the human steers fighter 1 with the P2 controls (arrows + numpad / P2 pad); the CPU takes fighter 0.
      const humanAsP2 = cpuSettings.enabled && cpuSettings.humanSide === 1 && !game.training.enabled && !demoActive;
      if (humanAsP2) inputs[0] = restarting ? neutralInput() : cpus[0].next(game);
      else if (demoActive) inputs[0] = restarting ? neutralInput() : cpus[0].next(game);
      if (cpuControlsOpponent && !humanAsP2) inputs[1] = restarting ? neutralInput() : cpus[1].next(game);
      else if ((cpuSettings.enabled || cpuSettings.demo) && game.training.enabled) inputs[1] = neutralInput();
      if (recording) {
        recording.frames.push(structuredClone({ inputs,events }));
        if (recording.frames.length >= MAX_REPLAY_FRAMES) { lastReplay=recording; recording=null; message(t('message.recordingLimit')); }
      }
      step(game,inputs,events);
      if(restarting)feedback.reset(game);
      feedback.update(game,previous);
      if(restarting)effects.reset(); else effects.update(game,previous,!loop.paused);
      playContactSound();
      if (events.some(e=>e.type==='reset'||e.type==='training')) previous=snapshot(game);
      if (demoActive && game.round.phase === 'matchOver') {
        if (++demoMatchOverFrames >= DEMO_MATCH_HOLD) { demoMatchOverFrames = 0; pendingEvents.push({ type:'reset' }); }
      } else demoMatchOverFrames = 0;
    }
    // A new round starts with its intro, or directly fighting without one (training).
    const roundStarted = previous.round.phase !== game.round.phase && (game.round.phase === 'intro' || (game.round.phase === 'fighting' && previous.round.phase !== 'intro'));
    if (roundStarted) { previous = snapshot(game);feedback.reset(game);effects.reset(); }
    loop.timeScale=slowMotion.update(game,feedback.koFrames);
  }
  function queue(event: ControlEvent): void {
    if (playback) stopPlayback();
    pendingEvents.push(event);
    if (loop.paused) { runFrame(); previous=snapshot(game); }
  }
  function togglePause(): void {
    if (playback && playback.index === playback.replay.frames.length) { game=snapshot(playback.replay.initial); feedback.reset(game);effects.reset();playback.index=0; }
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
  function toggleSide(): void {
    if (playback || game.training.enabled || cpuSettings.demo) return;
    cpuSettings.humanSide=cpuSettings.humanSide===1?0:1;saveCpuSettings(storage,cpuSettings);reset();
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
    if (recording) { lastReplay=recording; recording=null; message(t('message.recordingSaved',{frames:lastReplay.frames.length})); }
    else { recording=createReplay(game); message(t('message.recordingStarted')); }
  }
  function toggleReplay(): void {
    if (playback) { stopPlayback(); return; }
    if (recording) { lastReplay=recording; recording=null; }
    if (!lastReplay?.frames.length) { message(t('message.replayMissing')); return; }
    playback={replay:parseReplay(lastReplay),index:0,returnState:snapshot(game),returnKoFrames:[...feedback.koFrames],returnRelaxFrames:[...feedback.relaxFrames],returnLevels:[...feedback.levels]};
    game=snapshot(playback.replay.initial); feedback.reset(game);effects.reset();previous=snapshot(game); pendingEvents=[]; slowMotion.reset(); loop.timeScale=1; devices.clear(); setPaused(false);
    message(t('message.replayRunning'));
  }
  function singleStep(): void { if(loop.paused) { runFrame(); previous=snapshot(game); } }
  const actions: Record<string,()=>void> = {
    pause:togglePause, step:singleStep, reset,
    boxes:()=>showBoxes=!showBoxes, inputs:()=>showInputs=!showInputs, states:()=>showStates=!showStates,
    training:toggleTraining, dummy:changeDummy, record:toggleRecord, play:toggleReplay,
    cpu:toggleCpu, side:toggleSide, demo:toggleDemo, survival:toggleSurvival,
    sound:()=>{audio.setMuted(!audio.isMuted());audio.unlock();},
  };
  // Versus-only tools stay inactive during a survival run.
  const versusOnly = new Set(['training','dummy','record','play','cpu','side','demo']);
  const run = (id: string) => { if (survival && versusOnly.has(id)) return; actions[id](); updateUI(); };
  for (const id of Object.keys(actions)) button(id).onclick=()=>run(id);
  button('export-replay').onclick=()=>{ const replay=recording??lastReplay; if(replay)saveJson('stickman-replay.json',replay); };
  button('import-replay').onclick=()=>{ setPaused(true); element<HTMLInputElement>('replay-file').click(); };
  // Each selection gets a ticket; a slower earlier read that finishes later is discarded.
  let replayImportTicket=0;
  element<HTMLInputElement>('replay-file').onchange=async event=>{
    const input=event.target as HTMLInputElement, file=input.files?.[0], ticket=++replayImportTicket;
    input.value='';
    if(!file)return;
    try {
      if(file.size>MAX_REPLAY_FILE_BYTES)throw Error(t('message.replayTooLarge'));
      const text=await file.text();
      if(ticket!==replayImportTicket)return;
      const imported=parseReplay(JSON.parse(text));
      if(playback)stopPlayback();
      if(recording){recording=null;}
      lastReplay=imported;message(t('message.replayLoaded',{frames:imported.frames.length}));
    } catch(error) { if(ticket===replayImportTicket)message(String(error)); }
    finally { updateUI(); }
  };
  const pollSettings=setupSettings(devices,()=>{refreshBindings();queue({type:'inputConfig',config:{socd:structuredClone(devices.config.socd),bufferFrames:devices.config.bufferFrames,autoBlock:devices.config.players.map(p=>p.autoBlock === true) as [boolean,boolean]}});},message,effects.settings);
  element('settings-details').addEventListener('toggle',event=>{ if((event.target as HTMLDetailsElement).open)setPaused(true); });
  document.addEventListener('click',event=>{ if((event as MouseEvent).detail>0 && (event.target as HTMLElement).closest('button'))(document.activeElement as HTMLElement)?.blur(); });
  const hotkeys: Record<string,string> = { KeyP:'pause',Period:'step',Backspace:'reset',F1:'boxes',F2:'inputs',F3:'states',F4:'training',F5:'dummy',F6:'record',F7:'play',F8:'cpu',F9:'demo',F10:'survival' };
  window.addEventListener('keydown',event=>{
    if((event.target as HTMLElement).closest('#animation-preview'))return;
    if(event.repeat || devices.capture || (event.target as HTMLElement).matches('input,select,textarea'))return;
    // Upgrade choice: the digit keys 1–3 pick a card directly (the run stands still, so bound keys are free meanwhile).
    const card=/^Digit([1-9])$/.exec(event.code);
    if(card && survival?.choosing && !loop.paused){event.preventDefault();pickUpgrade(Number(card[1])-1,null);updateUI();return;}
    if(devices.config.players.some(p=>Object.values(p.keys).includes(event.code)))return;
    const action=hotkeys[event.code];if(action){event.preventDefault();run(action);}
  });
  window.addEventListener('blur',()=>{devices.clear();setPaused(true);message(t('message.focusLost'));});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){devices.clear();setPaused(true);}});
  window.addEventListener('gamepaddisconnected',()=>{devices.clear();setPaused(true);message(t('message.controllerLost'));});

  const hud = new Hud(document);
  function updateUI(): void {
    const s = survival?.state;
    hud.update({
      game: s ? survivalHudGame(s) : game,
      survival: s ? { side: survivalSide, time: formatSurvival(s.survivedFrames).slice(0, -3), best: formatSurvival(Math.max(survivalBest, s.survivedFrames)).slice(0, -3), enemies: s.enemies.filter(e => !e.dead).length, kills: s.kills, playerMaxHp: playerMaxHp(s), enemyMaxHp: survivalFocus(s)?.maxHp ?? 1, bossIn: formatSurvival(s.flow.bossTimer).slice(0, -3), boss: s.enemies.find(e => e.boss > 0 && !e.dead)?.boss ?? 0, energy: s.energy.total } : undefined,
      paused:loop.paused, muted:audio.isMuted(), cpu:cpuSettings, cpuDebug:[cpus[0].debug,cpus[1].debug],
      playback:playback?{index:playback.index,total:playback.replay.frames.length}:null,
      recordingFrames:recording?recording.frames.length:null, replayFrames:lastReplay?.frames.length??0,
      show:{boxes:showBoxes,inputs:showInputs,states:showStates}, stageCaption:STAGES[stage].caption,
      ready:{effects:effects.settings.effects,events:(fighter,resource)=>effects.readyEventCount(fighter,resource)},
    });
  }
  onLanguageChange(()=>{translateDocument();hud.invalidate();updateUI();});
  /** Smoke tests read the survival run from the canvas (presentation only). */
  function exposeSurvival(): void {
    const s = survival?.state, data = canvas.dataset;
    if (!s) { delete data.survival; delete data.upgrades; return; }
    // Nearest enemy in front and behind (px, -1 = none), landed hits of the player's
    // current attack (most on one enemy), the number of enemies it struck, enemies
    // held in a throw and shrugged-off throw attempts.
    const distances = (ahead: boolean) => s.enemies.filter(e => !e.dead && !e.entering && inFront(s.player, e.fighter) === ahead).map(e => Math.round(Math.abs(e.fighter.x - s.player.x) / rules.unit));
    const nearest = (list: number[]) => list.length ? Math.min(...list) : -1;
    const hits = Math.max(0, ...s.enemies.map(e => e.playerHits.length)), struck = s.enemies.filter(e => e.playerHits.length > 0).length;
    // Throws: enemies held right now and throw attempts a miniboss shrugged off.
    const thrown = s.enemies.filter(e => e.fighter.state === 'Thrown').length;
    // Upgrades: open cards | menu cursor | picks so far | player damage scale (permille).
    const upgrades = `${s.upgrades.offer?.join(',') ?? ''}|${upgradeChoice.cursor}|${s.upgrades.picks.join(',')}|${s.player.damageScalePermille}`;
    if (data.upgrades !== upgrades) data.upgrades = upgrades;
    data.survival = `${s.player.facing}|${s.enemies.filter(e => !e.dead).length}|${s.enemies.filter(e => e.warn > 0).length}|${s.over ? 1 : 0}|${s.turns}|${s.enemies.find(e => e.boss > 0 && !e.dead)?.boss ?? 0}|${s.flow.bosses}|${s.energy.total}|${nearest(distances(true))}|${hits}|${nearest(distances(false))}|${struck}|${thrown}|${s.shrug.count}`;
  }
  const hudElement = document.getElementById('hud')!;
  /** Bottom of the DOM HUD in logical canvas pixels, so canvas overlays (boss bar) stay clear of it. */
  function survivalLayout(): { hudBottom: number } {
    const box = canvas.getBoundingClientRect(), hudBox = hudElement.getBoundingClientRect();
    return { hudBottom: box.width ? (hudBox.bottom - box.top) * 960 / box.width : 0 };
  }
  function frame(time: number): void {
    const alpha=loop.advance(time,runFrame);
    fitCanvas(canvas);
    if (survival && survivalPrevious) renderSurvival(canvas,survival.state,survivalPrevious,loop.paused?1:alpha,loop.paused,palette,stage,effects,survivalBest,survivalLayout(),upgradeChoice.cursor);
    else render(canvas,game,previous,loop.paused?1:alpha,loop.paused,showBoxes,palette,feedback.levels,feedback.koFrames,stage,cpuSettings.demo && !game.training.enabled,feedback.relaxFrames,effects);
    preview(time,palette);
    pollSettings();updateUI();exposeSurvival();requestAnimationFrame(frame);
  }
  updateUI();requestAnimationFrame(frame);
}

void main().catch(error=>{document.querySelector('#app')!.textContent=t('message.startFailed',{error:String(error)});});
