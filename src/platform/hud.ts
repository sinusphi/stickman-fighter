import rules from '../data/rules.json';
import type { GameState } from '../simulation/types';
import type { Intent } from '../ai/brain';
import type { CpuSettings, Difficulty } from '../ai/profiles';
import type { DummyMode } from '../debug/training';
import { inputLines, stateLine } from '../debug/display';
import { t } from './i18n';

/** Everything the HUD shows, gathered once per animation frame by main. */
export interface HudContext {
  game: GameState;
  paused: boolean;
  muted: boolean;
  cpu: CpuSettings;
  cpuDebug: readonly [Intent, Intent];
  playback: { index: number; total: number } | null;
  recordingFrames: number | null;
  replayFrames: number;
  show: { boxes: boolean; inputs: boolean; states: boolean };
  stageCaption: string;
  /** "Bar full" presentation: effects switch and the monotonic event count per bar (see HitEffects). */
  ready?: { effects: boolean; events: (fighter: number, resource: 'revenge' | 'special') => number };
  /** Survival run: `game` is then a [player, focused enemy] view (see survival/views). */
  survival?: SurvivalHud;
}
export interface SurvivalHud {
  /** Controls slot (P1/P2) the survival player uses. */
  side?: 0 | 1;
  time: string; best: string; enemies: number; kills: number; playerMaxHp: number; enemyMaxHp: number;
  /** Boss line: seconds until the next boss, or the number of the boss being fought (0 = none). */
  bossIn: string; boss: number;
  /** Energy won back so far. */
  energy: number;
}

/** cpuSide: the fighter a single CPU opponent controls (VS CPU as P2 puts it on fighter 0). */
export interface HudModes { trainingCpu: boolean; cpuActive: boolean; demoActive: boolean; cpuPresent: boolean; cpuSide: 0 | 1 }

export function hudModes(c: Pick<HudContext, 'game' | 'cpu' | 'playback'>): HudModes {
  const training = c.game.training;
  const trainingCpu = training.enabled && training.dummy === 'cpu';
  const cpuActive = c.cpu.enabled && !training.enabled && !c.playback;
  const demoActive = c.cpu.demo && !training.enabled && !c.playback;
  const cpuSide: 0 | 1 = cpuActive && c.cpu.humanSide === 1 ? 0 : 1;
  return { trainingCpu, cpuActive, demoActive, cpuPresent: cpuActive || trainingCpu || demoActive, cpuSide };
}

const difficultyName = (difficulty: Difficulty) => t(`difficulty.${difficulty}`);
const dummyName = (mode: DummyMode) => t(`dummy.${mode}`);
const describeIntent = (index: number, intent: Intent) => `CPU ${index}: ${intent.reason}${intent.kind === 'attack' ? ' ' + intent.moveId : ''} (${intent.score.toFixed(2)})`;

/** Pure label texts of the HUD; kept separate from DOM writes so they can be tested. */
export function hudLabels(c: HudContext) {
  const { game, cpu, playback } = c;
  const m = hudModes(c);
  const s = c.survival;
  const level = difficultyName(m.cpuSide === 0 ? cpu.playerOneDifficulty : cpu.difficulty).toUpperCase();
  const demoLevels = `${difficultyName(cpu.playerOneDifficulty).toUpperCase()} VS ${level}`;
  return {
    cpuButton: m.trainingCpu ? t('cpu.trainingDummy') : game.training.enabled ? t('cpu.trainingPriority') : playback ? t('cpu.replayPriority') : `CPU: ${t(m.cpuActive ? 'common.on' : 'common.off')} · F8`,
    sideButton: t('side.label', { side: cpu.humanSide === 1 ? 'P2' : 'P1' }),
    cpuLevel: level,
    demoButton: game.training.enabled ? t('demo.trainingPriority') : playback ? t('demo.replayPriority') : `Demo: ${t(m.demoActive ? 'common.on' : 'common.off')} · F9`,
    p1: s ? (s.side === 1 ? 'PLAYER 02' : 'PLAYER 01') : m.demoActive ? 'CPU 01' : m.cpuActive && m.cpuSide === 0 ? 'CPU' : 'PLAYER 01',
    p2: s ? t('survival.enemies', { count: s.enemies }) : m.demoActive ? 'CPU 02' : m.cpuPresent && m.cpuSide === 1 ? 'CPU' : 'PLAYER 02',
    matchStatus: `${s ? 'SURVIVAL' : playback ? 'REPLAY' : m.trainingCpu ? 'TRAINING · CPU · ' + level : game.training.enabled ? 'TRAINING' : m.demoActive ? 'DEMO · ' + demoLevels : m.cpuActive ? 'VS CPU · ' + level : 'LOCAL VERSUS'} · ${rules.hz} HZ`,
    cpuDebug: m.demoActive ? c.cpuDebug.map((intent, i) => describeIntent(i + 1, intent)).join('\n') : m.cpuPresent ? describeIntent(m.cpuSide + 1, c.cpuDebug[m.cpuSide]) : '',
    arenaMode: s ? `${c.stageCaption} / ${t('survival.mode', { kills: s.kills })} · ${s.boss ? t('survival.boss', { n: s.boss }) : t('survival.bossIn', { time: s.bossIn })} · ${t('survival.energy', { energy: s.energy })}` : playback ? `REPLAY / ${playback.index} : ${playback.total}`
      : c.recordingFrames !== null ? `REC / ${c.recordingFrames} FRAMES`
      : m.trainingCpu ? `TRAINING / CPU · ${level}`
      : game.training.enabled ? `TRAINING / ${dummyName(game.training.dummy).toUpperCase()}`
      : m.demoActive ? `${c.stageCaption} / CPU-DEMO · ${demoLevels}`
      : m.cpuActive ? `${c.stageCaption} / VS CPU · ${level}`
      : `${c.stageCaption} / LOCAL 1V1`,
    timer: s ? s.time : game.training.enabled ? '∞' : String(Math.ceil(game.round.timer / rules.hz)).padStart(2, '0'),
    round: s ? t('survival.round', { time: s.best }) : game.training.enabled ? 'TRAINING' : `ROUND ${String(game.round.number).padStart(2, '0')}`,
    dummy: `Dummy: ${dummyName(game.training.dummy)} · F5`,
  };
}

/**
 * Writes the HUD into the DOM, touching an element only when its value
 * actually changed. Runs every animation frame, also while paused, so the
 * cached comparison keeps idle frames free of layout work.
 */
export class Hud {
  private cache = new Map<string, string>();
  private elements = new Map<string, HTMLElement>();
  /** Last seen "bar full" event count per bar; the first sighting never flashes. */
  private readySeen = new Map<string, number>();
  constructor(private readonly document: Document) {}

  invalidate(): void { this.cache.clear(); }

  private el(id: string): HTMLElement {
    let element = this.elements.get(id);
    if (!element) { element = this.document.getElementById(id)!; this.elements.set(id, element); }
    return element;
  }
  private changed(key: string, value: string): boolean {
    if (this.cache.get(key) === value) return false;
    this.cache.set(key, value); return true;
  }
  text(id: string, value: string): void { if (this.changed(`${id}|text`, value)) this.el(id).textContent = value; }
  html(id: string, value: string): void { if (this.changed(`${id}|html`, value)) this.el(id).innerHTML = value; }
  attr(id: string, name: string, value: string): void { if (this.changed(`${id}|@${name}`, value)) this.el(id).setAttribute(name, value); }
  flag(id: string, name: 'disabled' | 'hidden', value: boolean): void {
    if (this.changed(`${id}|${name}`, String(value))) (this.el(id) as HTMLButtonElement)[name] = value;
  }
  toggle(id: string, name: string, on: boolean): void {
    if (this.changed(`${id}|.${name}`, String(on))) this.el(id).classList.toggle(name, on);
  }
  /** Restarts the one-off flash animation of a bar that just became full. */
  private flash(id: string): void {
    const element = this.el(id);
    element.classList.remove('resource-flash');
    void element.offsetWidth;
    element.classList.add('resource-flash');
    this.cache.set(`${id}|.resource-flash`, 'true');
  }
  width(id: string, percent: number, child = false): void {
    const value = `${percent}%`;
    if (!this.changed(`${id}|width${child}`, value)) return;
    const element = child ? this.el(id).firstElementChild as HTMLElement : this.el(id);
    element.style.width = value;
  }

  update(c: HudContext): void {
    const { game, playback } = c, m = hudModes(c), labels = hudLabels(c);
    this.text('sound', t(c.muted ? 'sound.off' : 'sound.on'));
    this.attr('sound', 'title', t(c.muted ? 'sound.unmute' : 'sound.mute'));
    this.attr('sound', 'aria-pressed', String(!c.muted));
    // Survival: only the player's own auto block counts (enemies never auto block).
    const autoBlock = c.survival ? game.inputConfig.autoBlock?.[0] === true : game.inputConfig.autoBlock?.every(Boolean) ?? false;
    this.text('auto-block', t(autoBlock ? 'autoBlock.on' : 'autoBlock.off'));
    this.attr('auto-block', 'title', t(autoBlock ? 'autoBlock.disable' : 'autoBlock.enable'));
    this.attr('auto-block', 'aria-pressed', String(autoBlock));
    const survival = !!c.survival;
    this.toggle('hud', 'is-survival', survival);
    this.flag('cpu', 'disabled', game.training.enabled || !!playback || survival);
    this.flag('side', 'disabled', game.training.enabled || !!playback || survival || m.demoActive);
    this.text('side', labels.sideButton);
    this.attr('side', 'aria-pressed', String(c.cpu.humanSide === 1));
    this.flag('demo', 'disabled', game.training.enabled || !!playback || survival);
    this.flag('cpu-level-0', 'disabled', !!playback || game.training.enabled || survival);
    this.flag('cpu-level', 'disabled', !!playback || (game.training.enabled && !m.trainingCpu) || survival);
    this.flag('training', 'disabled', survival);
    this.flag('record', 'disabled', survival);
    this.flag('survival', 'disabled', game.training.enabled || !!playback);
    this.attr('survival', 'aria-pressed', String(survival));
    this.attr('cpu', 'aria-pressed', String(m.cpuActive || m.trainingCpu));
    this.attr('demo', 'aria-pressed', String(m.demoActive));
    this.text('cpu', labels.cpuButton);
    this.text('demo', labels.demoButton);
    this.text('p1-label', labels.p1);
    this.text('p2-label', labels.p2);
    this.text('match-status', labels.matchStatus);
    this.flag('cpu-debug', 'hidden', !m.cpuPresent);
    this.text('cpu-debug', labels.cpuDebug);
    this.text('pause', t(c.paused ? 'button.continue' : 'button.pause'));
    this.flag('step', 'disabled', !c.paused);
    this.attr('boxes', 'aria-pressed', String(c.show.boxes));
    this.attr('inputs', 'aria-pressed', String(c.show.inputs));
    this.attr('states', 'aria-pressed', String(c.show.states));
    this.attr('training', 'aria-pressed', String(game.training.enabled));
    this.flag('dummy', 'disabled', !game.training.enabled);
    this.text('dummy', labels.dummy);
    this.text('record', t(c.recordingFrames !== null ? 'button.stopRecord' : 'button.record'));
    this.attr('record', 'aria-pressed', String(c.recordingFrames !== null));
    this.flag('play', 'disabled', survival || (!playback && !c.replayFrames && !c.recordingFrames));
    this.text('play', t(playback ? 'button.leaveReplay' : 'button.replay'));
    this.flag('export-replay', 'disabled', !(c.recordingFrames ?? c.replayFrames));
    this.flag('debug', 'hidden', !c.show.states);
    this.flag('input-history', 'hidden', !c.show.inputs);
    for (const f of game.fighters) {
      for (const name of ['revenge', 'special'] as const) {
        const resource = f.resources[name], track = `resource-${f.id}-${name}`;
        this.text(`resource-value-${f.id}-${name}`, `${resource.current} / ${resource.max}`);
        this.attr(track, 'aria-valuenow', String(resource.current));
        this.attr(track, 'aria-valuemax', String(resource.max));
        this.width(track, resource.current / resource.max * 100, true);
        // Bar full: static highlight and READY label; flash and pulse follow the effects switch.
        const full = resource.current >= resource.max, effects = c.ready?.effects ?? true;
        const events = c.ready?.events(f.id, name), seen = this.readySeen.get(track);
        if (events !== undefined) this.readySeen.set(track, events);
        this.toggle(track, 'is-full', full);
        this.toggle(`resource-ready-${f.id}-${name}`, 'is-visible', full);
        this.toggle(track, 'is-pulsing', full && effects);
        if (full && effects && events !== undefined && seen !== undefined && events > seen) this.flash(track);
        else if (!full || !effects) this.toggle(track, 'resource-flash', false);
      }
      const maxHp = c.survival ? f.id === 0 ? c.survival.playerMaxHp : c.survival.enemyMaxHp : rules.maxHealth;
      this.text(`hp-${f.id}`, `${f.hp} / ${maxHp}`);
      this.width(`health-${f.id}`, f.hp / maxHp * 100);
      if (this.changed(`health-${f.id}|now`, String(f.hp))) this.el(`health-${f.id}`).parentElement!.setAttribute('aria-valuenow', String(f.hp));
      this.html(`wins-${f.id}`, c.survival ? '' : Array.from({ length: rules.winsRequired }, (_, i) => `<span class="${game.round.wins[f.id] > i ? 'won' : ''}"></span>`).join(''));
      // Smoke tests and screen readers read these even while the panel is hidden.
      this.text(`state-${f.id}`, `${stateLine(f)}\n${t('state.inputFrame')} ${game.frame} · ${t('state.combatFrame')} ${game.combatFrame} · Hitstop ${game.hitstop}f`);
      if (c.show.inputs) this.text(`input-${f.id}`, inputLines(f));
    }
    this.text('timer', labels.timer);
    this.text('round-label', labels.round);
    this.text('arena-mode', labels.arenaMode);
    const canvas = this.el('game');
    canvas.dataset.frame = String(game.frame); canvas.dataset.ready = 'true';
  }
}
