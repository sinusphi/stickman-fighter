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
}

export interface HudModes { trainingCpu: boolean; cpuActive: boolean; demoActive: boolean; cpuPresent: boolean }

export function hudModes(c: Pick<HudContext, 'game' | 'cpu' | 'playback'>): HudModes {
  const training = c.game.training;
  const trainingCpu = training.enabled && training.dummy === 'cpu';
  const cpuActive = c.cpu.enabled && !training.enabled && !c.playback;
  const demoActive = c.cpu.demo && !training.enabled && !c.playback;
  return { trainingCpu, cpuActive, demoActive, cpuPresent: cpuActive || trainingCpu || demoActive };
}

const difficultyName = (difficulty: Difficulty) => t(`difficulty.${difficulty}`);
const dummyName = (mode: DummyMode) => t(`dummy.${mode}`);
const describeIntent = (index: number, intent: Intent) => `CPU ${index}: ${intent.reason}${intent.kind === 'attack' ? ' ' + intent.moveId : ''} (${intent.score.toFixed(2)})`;

/** Pure label texts of the HUD; kept separate from DOM writes so they can be tested. */
export function hudLabels(c: HudContext) {
  const { game, cpu, playback } = c;
  const m = hudModes(c);
  const level = difficultyName(cpu.difficulty).toUpperCase();
  const demoLevels = `${difficultyName(cpu.playerOneDifficulty).toUpperCase()} VS ${level}`;
  return {
    cpuButton: m.trainingCpu ? t('cpu.trainingDummy') : game.training.enabled ? t('cpu.trainingPriority') : playback ? t('cpu.replayPriority') : `CPU: ${t(m.cpuActive ? 'common.on' : 'common.off')} · F8`,
    demoButton: game.training.enabled ? t('demo.trainingPriority') : playback ? t('demo.replayPriority') : `Demo: ${t(m.demoActive ? 'common.on' : 'common.off')} · F9`,
    p1: m.demoActive ? 'CPU 01' : 'PLAYER 01',
    p2: m.demoActive ? 'CPU 02' : m.cpuPresent ? 'CPU' : 'PLAYER 02',
    matchStatus: `${playback ? 'REPLAY' : m.trainingCpu ? 'TRAINING · CPU · ' + level : game.training.enabled ? 'TRAINING' : m.demoActive ? 'DEMO · ' + demoLevels : m.cpuActive ? 'VS CPU · ' + level : 'LOCAL VERSUS'} · ${rules.hz} HZ`,
    cpuDebug: m.demoActive ? c.cpuDebug.map((intent, i) => describeIntent(i + 1, intent)).join('\n') : m.cpuPresent ? describeIntent(2, c.cpuDebug[1]) : '',
    arenaMode: playback ? `REPLAY / ${playback.index} : ${playback.total}`
      : c.recordingFrames !== null ? `REC / ${c.recordingFrames} FRAMES`
      : m.trainingCpu ? `TRAINING / CPU · ${level}`
      : game.training.enabled ? `TRAINING / ${dummyName(game.training.dummy).toUpperCase()}`
      : m.demoActive ? `${c.stageCaption} / CPU-DEMO · ${demoLevels}`
      : m.cpuActive ? `${c.stageCaption} / VS CPU · ${level}`
      : `${c.stageCaption} / LOCAL 1V1`,
    timer: game.training.enabled ? '∞' : String(Math.ceil(game.round.timer / rules.hz)).padStart(2, '0'),
    round: game.training.enabled ? 'TRAINING' : `ROUND ${String(game.round.number).padStart(2, '0')}`,
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
    const autoBlock = game.inputConfig.autoBlock?.every(Boolean) ?? false;
    this.text('auto-block', t(autoBlock ? 'autoBlock.on' : 'autoBlock.off'));
    this.attr('auto-block', 'title', t(autoBlock ? 'autoBlock.disable' : 'autoBlock.enable'));
    this.attr('auto-block', 'aria-pressed', String(autoBlock));
    this.flag('cpu', 'disabled', game.training.enabled || !!playback);
    this.flag('demo', 'disabled', game.training.enabled || !!playback);
    this.flag('cpu-level-0', 'disabled', !!playback || game.training.enabled);
    this.flag('cpu-level', 'disabled', !!playback || (game.training.enabled && !m.trainingCpu));
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
    this.flag('play', 'disabled', !playback && !c.replayFrames && !c.recordingFrames);
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
      this.text(`hp-${f.id}`, `${f.hp} / ${rules.maxHealth}`);
      this.width(`health-${f.id}`, f.hp / rules.maxHealth * 100);
      if (this.changed(`health-${f.id}|now`, String(f.hp))) this.el(`health-${f.id}`).parentElement!.setAttribute('aria-valuenow', String(f.hp));
      this.html(`wins-${f.id}`, Array.from({ length: rules.winsRequired }, (_, i) => `<span class="${game.round.wins[f.id] > i ? 'won' : ''}"></span>`).join(''));
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
