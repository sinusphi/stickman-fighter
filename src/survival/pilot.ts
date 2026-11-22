import rules from '../data/rules.json';
import { CpuPlayer } from '../ai';
import { Controller, directionInput } from '../ai/controller';
import { KNOWLEDGE, MOVE_INFO, nextHitLevel, reaches } from '../ai/knowledge';
import { Rng } from '../ai/rng';
import { neutralInput, type RawInput } from '../input/types';
import { requiresCrouchGuard } from '../simulation/guard';
import type { Director } from './director';
import { SURVIVAL } from './config';
import type { Enemy, SurvivalState } from './state';

const U = rules.unit;
const READY = ['Idle', 'Walk', 'Crouch', 'CrouchWalk'];
/** Quick single-button moves a back attacker uses right after its warning. */
const BACK_STRIKES = KNOWLEDGE.filter(m => m.stance === 'standing' && m.startup <= 16 &&
  (m.command.type === 'normal' || (m.command.type === 'hold' && m.command.buttons.length === 1)));
const WALL_MARGIN = 30 * U;

/**
 * Input source of one survival enemy. With an attack token (and after its
 * start delay) the existing CPU drives it, its attacks filtered by the
 * director. Back attackers walk up, hold still during the warning and then
 * strike once. Without a token the enemy keeps its waiting spot and guards
 * now and then when the player swings at it.
 */
export class EnemyPilot {
  readonly cpu: CpuPlayer;
  private strike = new Controller();
  private rng: Rng;
  private guardAttack = -1;
  private guarding = false;
  /** The CPU drove this enemy in the previous frame. */
  private driving = false;
  constructor(readonly uid: number, seed: number, private director: Director, private config = SURVIVAL) {
    this.cpu = new CpuPlayer(config.enemies.difficulty, 1);
    this.cpu.reset(seed);
    this.cpu.gate = (moveId, frame) => director.allowMove(uid, moveId, frame);
    this.rng = new Rng((seed ^ 0x9e3779b9) | 0);
  }

  next(state: SurvivalState, enemy: Enemy): RawInput {
    const f = enemy.fighter, frame = state.frame, director = this.director;
    if (state.over || f.state === 'KO') return neutralInput();
    if (enemy.entering) return directionInput(6, f.facing);
    // A prepared strike is dropped when the enemy gets hit before it starts.
    if (this.strike.busy && !READY.includes(f.state) && f.state !== 'Attack') this.strike.clear();
    if (this.strike.busy) return this.release(this.strike.next(f));
    const phase = director.backPhase(this.uid, frame);
    if (phase) return this.release(this.backAttack(state, enemy, phase));
    if (director.token(this.uid) && director.mayAttack(this.uid, frame)) { this.driving = true; return this.cpu.next(enemy.pair); }
    return this.release(director.token(this.uid) ? this.hold(state, enemy) : this.lurk(state, enemy));
  }

  /** Leaving CPU control: a sequence still queued there must never fire later without the director. */
  private release(input: RawInput): RawInput {
    if (this.driving) { this.cpu.interrupt(); this.driving = false; }
    return input;
  }

  /** Start delay: stay put, but still guard. */
  private hold(state: SurvivalState, enemy: Enemy): RawInput {
    return this.guard(state, enemy) ?? neutralInput();
  }

  private backAttack(state: SurvivalState, enemy: Enemy, phase: 'approach' | 'warn' | 'strike'): RawInput {
    const f = enemy.fighter, p = state.player;
    if (!READY.includes(f.state)) return neutralInput();
    if (phase === 'warn') return neutralInput();
    if (phase === 'approach') return directionInput(6, f.facing);
    const options = BACK_STRIKES.filter(m => reaches(m, f, p));
    if (!options.length) return directionInput(6, f.facing);
    const first = Math.floor(this.rng.next() * options.length);
    for (let i = 0; i < options.length; i++) {
      const move = options[(first + i) % options.length];
      if (!this.director.allowMove(this.uid, move.id, state.frame)) continue;
      this.strike.set({ kind: 'attack', moveId: move.id, score: 1, reason: 'back strike' }, f);
      return this.strike.next(f);
    }
    return neutralInput();
  }

  /** Guard against a player attack that is about to reach this enemy, decided once per attack. */
  private guard(state: SurvivalState, enemy: Enemy): RawInput | null {
    const f = enemy.fighter, p = state.player;
    if (p.state !== 'Attack' || !p.moveId) { if (f.state !== 'Blockstun') this.guarding = false; return f.state === 'Blockstun' && this.guarding ? directionInput(4, f.facing) : null; }
    const move = MOVE_INFO[p.moveId], level = nextHitLevel(p.moveId, p.moveFrame);
    if (!move || level === null || Math.abs(p.x - f.x) > move.reach + 40 * U) return null;
    if (this.guardAttack !== p.attackId) { this.guardAttack = p.attackId; this.guarding = this.rng.next() < this.config.lurk.blockChance; }
    if (!this.guarding) return null;
    return directionInput(requiresCrouchGuard(level, move.stance, p.y < 0) ? 1 : 4, f.facing);
  }

  /** No token: keep the waiting spot at the director's distance from the player. */
  private lurk(state: SurvivalState, enemy: Enemy): RawInput {
    const f = enemy.fighter, p = state.player;
    const guard = this.guard(state, enemy);
    if (guard) return guard;
    if (!READY.includes(f.state)) return neutralInput();
    const side = Math.sign(f.x - p.x) || -f.facing;
    const target = Math.min(rules.stageWidth - WALL_MARGIN, Math.max(WALL_MARGIN, p.x + side * this.director.lurkDistance(this.uid) * U));
    const delta = target - f.x;
    if (Math.abs(delta) <= this.config.lurk.deadband * U) return neutralInput();
    return directionInput(Math.sign(delta) === f.facing ? 6 : 4, f.facing);
  }
}
