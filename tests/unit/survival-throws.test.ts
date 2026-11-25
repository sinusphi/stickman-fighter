import { describe, expect, it } from 'vitest';
import rules from '../../src/data/rules.json';
import { MOVES } from '../../src/data/schema';
import { buttonBit, neutralInput, type RawInput } from '../../src/input/types';
import { transition } from '../../src/simulation/movement';
import { SURVIVAL, type EnemyTypeId } from '../../src/survival/config';
import { SurvivalSession } from '../../src/survival/session';
import { bossSpec } from '../../src/survival/spawner';
import { createSurvival, spawnEnemy, stepSurvival, survivalGrabbable, type Enemy, type SurvivalState } from '../../src/survival/state';

const U = rules.unit;
const THROW = buttonBit('THROW');
const quiet = () => { const s = createSurvival(1); s.spawnTimer = 1e9; s.flow.bossTimer = 1e9; s.flow.waveTimer = 1e9; return s; };
/** 6 (forward) or 4 (back) relative to the player's facing, plus THROW. */
const throwInput = (s: SurvivalState, numpad: 4 | 6): RawInput => {
  const forward = numpad === 6 ? s.player.facing : -s.player.facing;
  return { ...neutralInput(), left: forward < 0, right: forward > 0, buttons: THROW };
};
function place(s: SurvivalState, offset: number, kind: EnemyTypeId | 'boss' = 'rookie'): Enemy {
  const e = spawnEnemy(s, offset < 0 ? -1 : 1, kind === 'boss' ? bossSpec(s.config, 1) : kind);
  e.entering = false; e.fighter.x = s.player.x + offset * U; e.fighter.facing = offset < 0 ? 1 : -1;
  return e;
}
const run = (s: SurvivalState, frames: number) => { for (let i = 0; i < frames; i++) stepSurvival(s, neutralInput()); };
/** Starts a throw attempt and steps until the grab frame has passed. */
function attempt(s: SurvivalState, numpad: 4 | 6 = 6): void {
  stepSurvival(s, throwInput(s, numpad));
  run(s, MOVES.throw_forward.startup + 2);
}
const TYPES = Object.keys(SURVIVAL.types) as EnemyTypeId[];

describe('survival: player throws', () => {
  it.each(TYPES)('throws a %s: knockdown, damage and energy like a normal hit', type => {
    const s = quiet(), e = place(s, 50, type);
    s.player.hp = 500;
    const hp = e.fighter.hp, special = s.player.resources.special.current;
    attempt(s);
    expect(e.fighter.state).toBe('Thrown');
    expect(s.player.moveId).toBe('throw_forward_exec');
    let landed = false;
    for (let i = 0; i < 60 && !landed; i++) { stepSurvival(s, neutralInput()); landed = e.fighter.state !== 'Thrown'; }
    expect(e.fighter.state).toBe('Knockdown');
    expect(hp - e.fighter.hp).toBe(MOVES.throw_forward_exec.damage);
    // Energy like one landed hit (no combo bonus), the bars gain as in versus.
    expect(s.player.hp).toBe(500 + SURVIVAL.energy.perHit);
    expect(s.player.resources.special.current).toBeGreaterThan(special);
    expect(e.fighter.resources.revenge.current).toBeGreaterThan(0);
    expect(e.poise).toBe(0);
    expect(s.focus).toBe(e.uid);
  });

  it('back throw puts the enemy behind the player, the player keeps facing', () => {
    const s = quiet(), e = place(s, 50, 'heavy');
    attempt(s, 4);
    expect(s.player.moveId).toBe('throw_back_exec');
    run(s, 60);
    expect(e.fighter.x).toBeLessThan(s.player.x);
    expect(s.player.facing).toBe(1);
    expect(e.fighter.hp).toBe(SURVIVAL.types.heavy.hp - MOVES.throw_back_exec.damage);
  });

  it('grabs enemies in hitstun (survival only), not airborne or knocked down ones', () => {
    const s = quiet(), e = place(s, 50);
    transition(e.fighter, 'Hitstun', 30);
    expect(survivalGrabbable(e.fighter)).toBe(true);
    attempt(s);
    expect(e.fighter.state).toBe('Thrown');

    const t = quiet(), down = place(t, 50);
    transition(down.fighter, 'Knockdown', 60);
    attempt(t);
    expect(down.fighter.state).toBe('Knockdown');
    expect(t.player.moveId).toBe('throw_forward');
  });

  it('seizes the closest enemy in range only', () => {
    const s = quiet(), near = place(s, 45), far = place(s, 60);
    attempt(s);
    expect(near.fighter.state).toBe('Thrown');
    expect(far.fighter.state).not.toBe('Thrown');
  });

  it('a miniboss shrugs every throw off: the attempt whiffs, no damage, feedback recorded', () => {
    const s = quiet(), boss = place(s, 50, 'boss');
    const hp = boss.fighter.hp;
    attempt(s);
    expect(boss.fighter.state).not.toBe('Thrown');
    expect(s.player.moveId).toBe('throw_forward');
    expect(s.shrug).toMatchObject({ count: 1, uid: boss.uid });
    run(s, 60);
    expect(boss.fighter.hp).toBe(hp);
    // Also in hitstun.
    transition(boss.fighter, 'Hitstun', 30);
    attempt(s);
    expect(boss.fighter.state).not.toBe('Thrown');
    expect(s.shrug.count).toBe(2);
  });

  it('enemies never throw', () => {
    const s = quiet(), e = place(s, 50);
    const input: RawInput = { ...neutralInput(), left: true, buttons: THROW };
    for (let i = 0; i < 10; i++) stepSurvival(s, neutralInput(), [input]);
    expect(s.player.state).not.toBe('Thrown');
    expect(MOVES[e.fighter.moveId ?? '']?.throw).toBeUndefined();
  });

  it('a throw that KOs counts the kill', () => {
    const s = quiet(), e = place(s, 50);
    e.fighter.hp = 50;
    attempt(s); run(s, 40);
    expect(e.fighter.state).toBe('KO');
    expect(s.kills).toBe(1);
  });

  it('a hit on the player during the throw breaks it off without damage', () => {
    const s = quiet(), e = place(s, 50);
    attempt(s);
    expect(e.fighter.state).toBe('Thrown');
    run(s, s.hitstop);
    transition(s.player, 'Hitstun', 20);
    run(s, 2);
    expect(e.fighter.state).toBe('Knockdown');
    expect(e.fighter.hp).toBe(SURVIVAL.types.rookie.hp);
  });
});

describe('survival: director during player throws', () => {
  /** Throws whenever an enemy stands in reach in front and the player is free. */
  function play(seed: number, frames: number) {
    const session = new SurvivalSession(seed);
    const starts: { frame: number; uid: number }[] = [], last = new Map<number, number>();
    let throws = 0, lastThrowEnd = -Infinity, inThrow = false, grabFrame = -1;
    const pauses: [number, number][] = [];
    for (let i = 0; i < frames && !session.state.over; i++) {
      const s = session.state, p = s.player;
      const target = s.enemies.find(e => !e.dead && !e.entering && e.boss === 0 && Math.abs(e.fighter.x - p.x) < 52 * U && Math.sign(e.fighter.x - p.x) === p.facing);
      const free = p.state === 'Idle' || p.state === 'Walk';
      session.step(target && free ? throwInput(s, 6) : neutralInput());
      const now = session.state, executing = now.player.state === 'Attack' && MOVES[now.player.moveId ?? '']?.throw?.phase === 'execute';
      if (executing && !inThrow) { throws++; grabFrame = now.frame; }
      if (!executing && inThrow) { lastThrowEnd = now.frame; pauses.push([grabFrame, lastThrowEnd + SURVIVAL.director.throwGraceFrames]); }
      inThrow = executing;
      for (const e of now.enemies) if (e.fighter.state === 'Attack' && last.get(e.uid) !== e.fighter.attackId) {
        last.set(e.uid, e.fighter.attackId); starts.push({ frame: now.frame, uid: e.uid });
      }
    }
    return { throws, starts, pauses };
  }

  it('starts no enemy attack from the grab until the grace period after the throw is over', () => {
    let total = 0;
    for (const seed of [1, 2, 3]) {
      const { throws, starts, pauses } = play(seed, 2400);
      total += throws;
      // A few frames of slack after the grab for an input that was already buffered before it.
      const inside = starts.filter(a => pauses.some(([from, to]) => a.frame > from + rules.bufferFrames && a.frame <= to));
      expect(inside).toEqual([]);
      expect(starts.length).toBeGreaterThan(0);
    }
    expect(total).toBeGreaterThan(2);
  });

  it('vetoes attacks while the player executes a throw and frees them after the grace period', () => {
    const session = new SurvivalSession(4), s = session.state;
    s.spawnTimer = 1e9; s.flow.bossTimer = 1e9; s.flow.waveTimer = 1e9;
    place(s, 50);
    session.step(throwInput(s, 6));
    for (let i = 0; i < MOVES.throw_forward.startup + 2; i++) session.step(neutralInput());
    expect(s.player.moveId).toBe('throw_forward_exec');
    expect(session.director.throwPause(s.frame)).toBe(true);
    let frames = 0;
    while (s.player.state === 'Attack' && frames++ < 200) { session.step(neutralInput()); expect(session.director.throwPause(s.frame)).toBe(true); }
    for (let i = 0; i < SURVIVAL.director.throwGraceFrames + 1; i++) session.step(neutralInput());
    expect(session.director.throwPause(s.frame)).toBe(false);
  });
});
