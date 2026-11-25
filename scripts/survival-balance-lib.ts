/*
 * Headless survival balance run (see scripts/survival-balance.mjs).
 *
 * A simple player bot plays complete survival runs on the real, deterministic
 * survival session (director, pilots, spawner – nothing is mocked). Nothing
 * here writes into the simulation beyond the player's raw input.
 *
 * IMPORTANT: the bot is not a human. It reuses the versus CPU brain against
 * one target enemy at a time and only adds what survival needs (turning by
 * double tap, reacting to back warnings). Its absolute survival times say
 * little about what a player achieves. The numbers are meant for before/after
 * comparisons of tuning changes in src/survival/config.ts with the same
 * seeds, profiles and time limit.
 */
import rules from '../src/data/rules.json';
import { CpuPlayer } from '../src/ai';
import { directionInput } from '../src/ai/controller';
import type { CpuProfile, Difficulty } from '../src/ai/profiles';
import { Rng } from '../src/ai/rng';
import { neutralInput, type RawInput } from '../src/input/types';
import { SURVIVAL, type SurvivalConfig } from '../src/survival/config';
import { SurvivalSession } from '../src/survival/session';
import { alive, inFront, TURNABLE_STATES, type Enemy, type SurvivalState } from '../src/survival/state';

const U = rules.unit;
const HZ = rules.hz;
export const MINUTE_FRAMES = 60 * HZ;

export interface BotProfile {
  id: string;
  /** Base CPU level of the bot's fighting brain and single values on top of it. */
  difficulty: Difficulty;
  overrides: Partial<CpuProfile>;
  /** Chance to turn around when an enemy behind shows its attack warning (decided once per warning). */
  warnTurnChance: number;
  /** Turn when the closest enemy behind is nearer than this (px) and the closest one in front is clearly farther. */
  backCloseDistance: number;
  /** Frames after a turn before the bot may turn again. */
  turnCooldownFrames: number;
}

/** Two consistent, deliberately simple play styles. */
export const BOT_PROFILES = {
  defensive: {
    id: 'defensive', difficulty: 'medium',
    overrides: { aggression: 0.12, blockChance: 0.45, correctBlockChance: 0.75, attackPauseFrames: 40, throwChance: 0.1 },
    warnTurnChance: 0.9, backCloseDistance: 140, turnCooldownFrames: 45,
  },
  aggressive: {
    id: 'aggressive', difficulty: 'hard',
    overrides: { aggression: 0.7, blockChance: 0.15, correctBlockChance: 0.6, attackPauseFrames: 8, throwChance: 0.25 },
    warnTurnChance: 0.5, backCloseDistance: 90, turnCooldownFrames: 60,
  },
} satisfies Record<string, BotProfile>;
export type BotProfileId = keyof typeof BOT_PROFILES;

const isBack = (input: RawInput, facing: number) => facing === 1 ? input.left : input.right;

/**
 * Player bot: the versus CPU (as fighter 0) fights the targeted enemy through
 * that enemy's two-fighter `pair` view. It turns by double tap when nobody is
 * in front, when the boss or a close enemy is behind, or (by chance) when a
 * back attacker warns. Accidental double taps of the CPU's own back inputs
 * are filtered out, so the bot only turns on purpose.
 */
export class SurvivalBot {
  private cpu: CpuPlayer;
  private rng: Rng;
  private queue: ('back' | 'neutral')[] = [];
  private target: number | null = null;
  private turnReadyAt = 0;
  private warnDecided = new Set<number>();
  private prevBack = false;
  private lastBackEdge = -Infinity;
  /** The current output belongs to an intended turn. */
  private fromQueue = false;
  /** Turns the bot started on purpose. */
  turnsStarted = 0;

  constructor(readonly profile: BotProfile, seed: number, private config: SurvivalConfig = SURVIVAL) {
    this.cpu = new CpuPlayer(profile.difficulty, 0, undefined, profile.overrides);
    this.cpu.reset(seed);
    this.rng = new Rng((seed ^ 0x2f6b1d3) | 0);
  }

  next(state: SurvivalState): RawInput {
    this.fromQueue = false;
    return this.filter(state, this.decide(state));
  }

  private decide(state: SurvivalState): RawInput {
    const p = state.player;
    if (state.over) return neutralInput();
    const free = TURNABLE_STATES.includes(p.state) && p.y === 0 && !state.turn;
    if (this.queue.length) {
      if (!free) this.queue = [];
      else {
        this.fromQueue = true;
        return this.queue.shift() === 'back' ? directionInput(4, p.facing) : neutralInput();
      }
    }
    const living = state.enemies.filter(e => alive(e) && !e.entering);
    const dist = (e: Enemy) => Math.abs(e.fighter.x - p.x);
    const front = living.filter(e => inFront(p, e.fighter)).sort((a, b) => dist(a) - dist(b));
    const back = living.filter(e => !inFront(p, e.fighter)).sort((a, b) => dist(a) - dist(b));
    for (const uid of this.warnDecided) if (!back.some(e => e.uid === uid && e.warn > 0)) this.warnDecided.delete(uid);

    if (free && state.frame >= this.turnReadyAt && back.length) {
      let turn = !front.length || back.some(e => e.boss > 0);
      if (!turn && back[0] && dist(back[0]) < this.profile.backCloseDistance * U && dist(front[0]) > dist(back[0]) + 120 * U) turn = true;
      for (const e of back) if (e.warn > 0 && !this.warnDecided.has(e.uid)) {
        this.warnDecided.add(e.uid);
        if (this.rng.next() < this.profile.warnTurnChance) turn = true;
      }
      if (turn) {
        this.turnsStarted++; this.turnReadyAt = state.frame + this.profile.turnCooldownFrames;
        this.target = null;
        // Released first: a back input held from before would not count as a tap.
        this.queue = ['back', 'neutral', 'back', 'neutral'];
        return neutralInput();
      }
    }

    // Target: keep the current one while it stays in front, unless another one is much closer.
    const current = front.find(e => e.uid === this.target);
    const pick = !current || (front[0] && dist(front[0]) + 80 * U < dist(current)) ? front[0] : current;
    // The boss duel: the boss is the only attacker, everybody else watches.
    const boss = front.find(e => e.boss > 0);
    const chosen = boss ?? pick;
    if (!chosen) return neutralInput();
    this.target = chosen.uid;
    return this.cpu.next(chosen.pair);
  }

  /** Drops back taps of the CPU that would otherwise complete an unwanted double tap. */
  private filter(state: SurvivalState, input: RawInput): RawInput {
    const p = state.player;
    let back = isBack(input, p.facing);
    const free = TURNABLE_STATES.includes(p.state) && p.y === 0 && !state.turn;
    if (back && !this.prevBack && free && !this.fromQueue && !input.buttons &&
      state.frame - this.lastBackEdge <= this.config.turn.doubleTapFrames + 1) {
      input = { ...input, left: false, right: false };
      back = false;
    }
    if (back && !this.prevBack) this.lastBackEdge = state.frame;
    this.prevBack = back;
    return input;
  }
}

// ---------------------------------------------------------------- runs ---

export interface DeathCause {
  /** Archetype id of the last enemy that damaged the player (`boss` for minibosses), `unknown` if none. */
  type: string;
  side: 'front' | 'back' | 'unknown';
  /** Boss number of the attacker, 0 for regular enemies. */
  boss: number;
}

export interface MinuteStat {
  minute: number;
  /** Energy at the end of the minute (or at the end of the run inside it). */
  hpEnd: number;
  gained: number;
  lost: number;
}

export interface RunResult {
  seed: number;
  profile: string;
  survivedFrames: number;
  /** True when the run hit the time limit instead of ending by KO. */
  timeout: boolean;
  kills: Record<string, number>;
  /** Number of the last boss that appeared (0 = none). */
  bossReached: number;
  bossesKilled: number;
  death: DeathCause | null;
  minutes: MinuteStat[];
  energyGained: number;
  energyLost: number;
  turns: number;
  botTurns: number;
}

export interface RunOptions {
  seed: number;
  profile: BotProfileId;
  maxFrames: number;
  config?: SurvivalConfig;
}

/** One complete survival run of the bot. Same options, same result. */
export function runSurvival({ seed, profile, maxFrames, config = SURVIVAL }: RunOptions): RunResult {
  const session = new SurvivalSession(seed, undefined, config);
  const bot = new SurvivalBot(BOT_PROFILES[profile], (seed ^ 0x5eed) | 0, config);
  const kills: Record<string, number> = {};
  for (const id of Object.keys(config.types)) kills[id] = 0;
  kills.boss = 0;
  const counted = new Set<number>();
  const minutes: MinuteStat[] = [];
  let minute: MinuteStat = { minute: 1, hpEnd: 0, gained: 0, lost: 0 };
  let last: DeathCause | null = null, lost = 0, bossesKilled = 0;

  while (!session.state.over && session.state.survivedFrames < maxFrames) {
    const s = session.state, hp = s.player.hp, gainedBefore = s.energy.total, combatFrame = s.combatFrame;
    session.step(bot.next(s));
    const now = session.state, gained = now.energy.total - gainedBefore;
    const loss = Math.max(0, gained - (now.player.hp - hp));
    if (loss > 0) {
      lost += loss; minute.lost += loss;
      const hitter = now.enemies.find(e => e.pair.lastContact?.defender === 0 && e.pair.lastContact.frame === combatFrame);
      last = hitter
        ? { type: hitter.archetype, side: inFront(now.player, hitter.fighter) ? 'front' : 'back', boss: hitter.boss }
        : { type: 'unknown', side: 'unknown', boss: 0 };
    }
    minute.gained += gained;
    for (const e of now.enemies) if (e.dead && !counted.has(e.uid)) {
      counted.add(e.uid); kills[e.archetype] = (kills[e.archetype] ?? 0) + 1;
      if (e.boss) bossesKilled++;
    }
    // A minute is complete when the survived time crosses its boundary.
    if (now.survivedFrames > 0 && now.survivedFrames % MINUTE_FRAMES === 0 && now.survivedFrames / MINUTE_FRAMES === minute.minute) {
      minute.hpEnd = now.player.hp; minutes.push(minute);
      minute = { minute: minute.minute + 1, hpEnd: 0, gained: 0, lost: 0 };
    }
  }
  const s = session.state;
  if (minute.gained || minute.lost || s.survivedFrames % MINUTE_FRAMES) { minute.hpEnd = s.player.hp; minutes.push(minute); }
  return {
    seed, profile, survivedFrames: s.survivedFrames, timeout: !s.over, kills,
    bossReached: s.flow.bosses, bossesKilled, death: s.over ? last ?? { type: 'unknown', side: 'unknown', boss: 0 } : null,
    minutes, energyGained: s.energy.total, energyLost: lost, turns: s.turns, botTurns: bot.turnsStarted,
  };
}

// ------------------------------------------------------------- reports ---

export function percentile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const seconds = (frames: number) => (frames / HZ).toFixed(1);
const csvCell = (v: unknown) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
const csv = (rows: unknown[][]) => `${rows.map(r => r.map(csvCell).join(',')).join('\n')}\n`;

export function deathLabel(d: DeathCause | null): string {
  if (!d) return 'timeout';
  return `${d.boss ? `boss ${d.boss}` : d.type} (${d.side})`;
}

export function runsCsv(results: readonly RunResult[], types: readonly string[]): string {
  const maxMinutes = Math.max(0, ...results.map(r => r.minutes.length));
  const header = ['profile', 'seed', 'survived_s', 'timeout', ...types.map(t => `kills_${t}`), 'kills_boss', 'boss_reached', 'bosses_killed',
    'death_type', 'death_side', 'death_boss', 'energy_gained', 'energy_lost', 'turns', 'bot_turns',
    ...Array.from({ length: maxMinutes }, (_, i) => `hp_min${i + 1}`)];
  return csv([header, ...results.map(r => [r.profile, r.seed, seconds(r.survivedFrames), r.timeout ? 1 : 0, ...types.map(t => r.kills[t] ?? 0), r.kills.boss ?? 0,
    r.bossReached, r.bossesKilled, r.death?.type ?? '', r.death?.side ?? '', r.death?.boss ?? '', r.energyGained, r.energyLost, r.turns, r.botTurns,
    ...Array.from({ length: maxMinutes }, (_, i) => r.minutes[i]?.hpEnd ?? '')])]);
}

export function minutesCsv(results: readonly RunResult[]): string {
  return csv([['profile', 'seed', 'minute', 'hp_end', 'gained', 'lost', 'net'],
    ...results.flatMap(r => r.minutes.map(m => [r.profile, r.seed, m.minute, m.hpEnd, m.gained, m.lost, m.gained - m.lost]))]);
}

export interface SummaryOptions { seedStart: number; maxFrames: number; config?: SurvivalConfig }

/** Markdown summary of one profile's runs. */
export function summaryMarkdown(profile: string, results: readonly RunResult[], { seedStart, maxFrames, config = SURVIVAL }: SummaryOptions): string {
  const n = results.length, times = results.map(r => r.survivedFrames).sort((a, b) => a - b);
  const median = (values: number[]) => percentile([...values].sort((a, b) => a - b), 0.5);
  const fmt = (v: number) => Number.isInteger(v) ? String(v) : v.toFixed(1);
  const lines: string[] = [];
  lines.push(`## Profile \`${profile}\``, '');
  lines.push(`Runs: ${n} · seeds ${seedStart}–${seedStart + n - 1} · limit ${seconds(maxFrames)} s · timeouts: ${results.filter(r => r.timeout).length}`, '');
  lines.push('| Survived time | s |', '|---|---:|');
  lines.push(`| 10th percentile | ${seconds(percentile(times, 0.1))} |`, `| Median | ${seconds(percentile(times, 0.5))} |`, `| 90th percentile | ${seconds(percentile(times, 0.9))} |`);
  lines.push(`| Min / max | ${seconds(times[0] ?? 0)} / ${seconds(times[n - 1] ?? 0)} |`, '');

  const types = [...Object.keys(config.types), 'boss'];
  lines.push('| Kills per run | median | mean |', '|---|---:|---:|');
  for (const t of types) {
    const v = results.map(r => r.kills[t] ?? 0);
    lines.push(`| ${t} | ${fmt(median(v))} | ${(v.reduce((a, b) => a + b, 0) / Math.max(1, n)).toFixed(2)} |`);
  }
  const bossReached = results.map(r => r.bossReached);
  lines.push('', `Boss reached: median ${fmt(median(bossReached))}, max ${Math.max(0, ...bossReached)} · distribution: ` +
    countList(bossReached.map(String)).map(([k, c]) => `#${k}: ${c}`).join(', '), '');

  lines.push('| Cause of death (last damage) | runs | share |', '|---|---:|---:|');
  for (const [label, c] of countList(results.map(r => deathLabel(r.death)))) lines.push(`| ${label} | ${c} | ${(100 * c / n).toFixed(1)} % |`);
  const deaths = results.flatMap(r => r.death ? [r.death] : []);
  const backShare = deaths.length ? deaths.filter(d => d.side === 'back').length / deaths.length : 0;
  lines.push('', `Deaths from behind: ${(100 * backShare).toFixed(1)} % · deaths in a boss duel: ${deaths.filter(d => d.boss > 0).length}`, '');

  const gained = results.map(r => r.energyGained), lostAll = results.map(r => r.energyLost);
  lines.push(`Energy per run: gained median ${fmt(median(gained))}, lost median ${fmt(median(lostAll))}`, '');
  const maxMinutes = Math.max(0, ...results.map(r => r.minutes.length));
  lines.push('| Minute | runs alive at start | energy at end (median) | gained (mean) | lost (mean) | net (mean) |', '|---:|---:|---:|---:|---:|---:|');
  for (let m = 0; m < maxMinutes; m++) {
    const stats = results.map(r => r.minutes[m]).filter((x): x is MinuteStat => !!x);
    const mean = (f: (s: MinuteStat) => number) => (stats.reduce((a, s) => a + f(s), 0) / stats.length).toFixed(1);
    lines.push(`| ${m + 1} | ${stats.length} | ${fmt(median(stats.map(s => s.hpEnd)))} | ${mean(s => s.gained)} | ${mean(s => s.lost)} | ${mean(s => s.gained - s.lost)} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function countList(values: readonly string[]): [string, number][] {
  const map = new Map<string, number>();
  for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
  return [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en', { numeric: true }));
}
