import { describe, expect, it } from 'vitest';
import rules from '../../src/data/rules.json';
import { buttonBit, neutralInput, type RawInput } from '../../src/input/types';
import { SURVIVAL } from '../../src/survival/config';
import { SurvivalSession } from '../../src/survival/session';
import { alive, createSurvival, formatSurvival, inFront, snapshotSurvival, spawnEnemy, stepSurvival, type SurvivalState } from '../../src/survival/state';

const U = rules.unit;
const raw = (dir: { left?: boolean; right?: boolean; down?: boolean } = {}, buttons = 0): RawInput => ({ ...neutralInput(), ...dir, buttons });
const quiet = () => { const s = createSurvival(1); s.spawnTimer = 1e9; return s; };
function place(s: SurvivalState, offset: number) {
  const e = spawnEnemy(s, offset < 0 ? -1 : 1);
  e.entering = false; e.fighter.x = s.player.x + offset * U; e.fighter.facing = offset < 0 ? 1 : -1;
  return e;
}
const run = (s: SurvivalState, frames: number, input: RawInput = neutralInput(), enemies: RawInput[] = []) => { for (let i = 0; i < frames; i++) stepSurvival(s, input, enemies); };

describe('survival: turning by double tap', () => {
  it('walks backwards without turning and turns on a double tap against the facing', () => {
    const s = quiet(), x = s.player.x;
    run(s, 20, raw({ left: true }));
    expect(s.player.facing).toBe(1);
    expect(s.player.x).toBeLessThan(x);
    expect(s.player.state).toBe('Walk');
    run(s, 3); stepSurvival(s, raw({ left: true })); run(s, 2);
    expect(s.turn).toBeNull();
    stepSurvival(s, raw({ left: true }));
    expect(s.turn).not.toBeNull();
    const frames = SURVIVAL.turn.frames, facings: number[] = [];
    for (let i = 0; i < frames; i++) { stepSurvival(s, neutralInput()); facings.push(s.player.facing); }
    expect(s.turn).toBeNull();
    expect(s.player.facing).toBe(-1);
    expect(s.turns).toBe(1);
    // A short animation, not an instant flip: the old facing holds for the first frames.
    expect(facings[0]).toBe(1);
  });

  it('ignores slow taps, taps during an attack and a back tap with a button', () => {
    const s = quiet();
    stepSurvival(s, raw({ left: true })); run(s, SURVIVAL.turn.doubleTapFrames + 2); stepSurvival(s, raw({ left: true }));
    expect(s.turn).toBeNull();
    run(s, 30);
    stepSurvival(s, raw({}, buttonBit('HP')));
    expect(s.player.state).toBe('Attack');
    stepSurvival(s, raw({ left: true })); stepSurvival(s, neutralInput()); stepSurvival(s, raw({ left: true }));
    expect(s.turn).toBeNull();
    run(s, 60);
    // Back starts a command move without side effects.
    stepSurvival(s, raw({ left: true })); stepSurvival(s, neutralInput()); stepSurvival(s, raw({ left: true }, buttonBit('MK')));
    expect(s.turn).toBeNull();
    expect(s.player.moveId).toBe('spin_mk');
    expect(s.player.facing).toBe(1);
  });

  it('blocks attacks and walking while turning', () => {
    const s = quiet();
    stepSurvival(s, raw({ left: true })); stepSurvival(s, neutralInput()); stepSurvival(s, raw({ left: true }));
    const x = s.player.x;
    stepSurvival(s, raw({}, buttonBit('LP'))); stepSurvival(s, raw({ right: true }));
    expect(s.player.state).not.toBe('Attack');
    expect(s.player.x).toBe(x);
  });
});

describe('survival: run flow', () => {
  it('starts in the middle, spawns from both sides up to the maximum and replaces the fallen', () => {
    const s = createSurvival(3);
    expect(s.player.x).toBe(Math.round(rules.stageWidth / 2));
    run(s, SURVIVAL.enemies.firstSpawnFrames + SURVIVAL.enemies.spawnIntervalFrames * (SURVIVAL.enemies.max + 2));
    expect(s.enemies.filter(alive)).toHaveLength(SURVIVAL.enemies.max);
    expect(new Set(s.enemies.map(e => Math.sign(e.fighter.x - s.player.x))).size).toBe(2);
    s.enemies[0].fighter.hp = 0; s.enemies[0].fighter.state = 'KO';
    stepSurvival(s, neutralInput());
    expect(s.kills).toBe(1);
    run(s, SURVIVAL.enemies.spawnIntervalFrames + 1);
    expect(s.enemies.filter(alive)).toHaveLength(SURVIVAL.enemies.max);
    run(s, SURVIVAL.enemies.koRemoveFrames);
    expect(s.enemies.every(e => !e.dead)).toBe(true);
  });

  it('enemies walk in from outside the arena', () => {
    const s = createSurvival(5);
    run(s, SURVIVAL.enemies.firstSpawnFrames);
    const e = s.enemies[0];
    expect(e.entering).toBe(true);
    expect(e.fighter.x < 0 || e.fighter.x > rules.stageWidth).toBe(true);
  });

  it('ends only when the player energy is empty and keeps the survived time', () => {
    const s = quiet(); run(s, 120);
    expect(s.survivedFrames).toBe(120);
    const e = place(s, 45); s.player.hp = 1;
    stepSurvival(s, neutralInput(), [raw({}, buttonBit('HP'))]);
    run(s, 30);
    expect(s.over).toBe(true);
    const survived = s.survivedFrames; run(s, 60);
    expect(s.survivedFrames).toBe(survived);
    expect(e.fighter.state).not.toBe('Attack');
    expect(formatSurvival(rules.hz * 83 + 30)).toBe('1:23.50');
  });

  it('one swing hits several enemies', () => {
    const s = quiet(), a = place(s, 40), b = place(s, 80);
    stepSurvival(s, raw({}, buttonBit('LK'))); run(s, 50);
    expect(a.fighter.hp).toBeLessThan(SURVIVAL.enemies.hp);
    expect(b.fighter.hp).toBeLessThan(SURVIVAL.enemies.hp);
  });

  it('attacks into the back cannot be blocked, attacks in front can', () => {
    for (const [offset, expected] of [[30, 'Blockstun'], [-30, 'Hitstun']] as const) {
      const s = quiet(); place(s, offset);
      // Standing guard against a HIGH punch: hold back.
      const back = raw({ left: true }), states: string[] = [];
      stepSurvival(s, back, [raw({}, buttonBit('LP'))]);
      for (let i = 0; i < 20; i++) { stepSurvival(s, back); states.push(s.player.state); }
      expect(states).toContain(expected);
    }
  });

  it('heavy hits knock the basic enemy down, it stands up again', () => {
    const s = quiet(), e = place(s, 40);
    stepSurvival(s, raw({ right: true }, buttonBit('HK')));
    const states: string[] = [];
    for (let i = 0; i < 120; i++) { stepSurvival(s, neutralInput()); states.push(e.fighter.state); }
    expect(s.player.moveId === 'spin_hk' || states.includes('Knockdown')).toBe(true);
    expect(states).toContain('Knockdown');
    expect(states.at(-1)).toBe('Idle');
  });
});

describe('survival: director', () => {
  function play(seed: number, frames: number, input: (s: SurvivalState, i: number) => RawInput = () => neutralInput()) {
    const session = new SurvivalSession(seed), log: { frame: number; uid: number; move: string; behind: boolean; warned: boolean }[] = [];
    const last = new Map<number, number>(), warnedAt = new Map<number, number>();
    // Warnings are measured in active frames: a global hitstop freezes everything, the warning included.
    let maxFront = 0, maxBack = 0, active = 0;
    for (let i = 0; i < frames && !session.state.over; i++) {
      session.step(input(session.state, i));
      const s = session.state;
      if (s.hitstop === 0) active++;
      let front = 0, back = 0;
      for (const e of s.enemies) {
        const token = session.director.token(e.uid);
        if (token === 'front') front++; else if (token === 'back') back++;
        if (e.warn > 0) warnedAt.set(e.uid, active);
        if (e.fighter.state === 'Attack' && e.fighter.moveFrame === 0 && last.get(e.uid) !== e.fighter.attackId) {
          last.set(e.uid, e.fighter.attackId);
          log.push({ frame: s.frame, uid: e.uid, move: e.fighter.moveId!, behind: !inFront(s.player, e.fighter), warned: active - (warnedAt.get(e.uid) ?? -1e9) <= 6 });
        }
      }
      maxFront = Math.max(maxFront, front); maxBack = Math.max(maxBack, back);
    }
    return { session, log, maxFront, maxBack };
  }

  it('keeps the token budgets and attacks happen', () => {
    for (const seed of [1, 2, 3]) {
      const { log, maxFront, maxBack } = play(seed, 3000);
      expect(maxFront).toBeLessThanOrEqual(SURVIVAL.director.frontTokens);
      expect(maxBack).toBeLessThanOrEqual(SURVIVAL.director.backTokens);
      expect(log.length).toBeGreaterThan(10);
      expect(log.some(entry => entry.behind)).toBe(true);
    }
  });

  it('warns before every attack from behind and keeps them rare', () => {
    for (const seed of [4, 5, 6]) {
      const { log } = play(seed, 3000);
      const behind = log.filter(entry => entry.behind);
      expect(behind.every(entry => entry.warned)).toBe(true);
      expect(behind.length).toBeLessThan(log.length / 2);
    }
  });

  it('never lets two enemies start the same move at once and spaces attack starts', () => {
    const tolerance = 6;
    for (const seed of [7, 8, 9]) {
      const { log } = play(seed, 3000);
      for (let i = 0; i < log.length; i++) for (let j = i + 1; j < log.length; j++) {
        const a = log[i], b = log[j];
        if (a.uid === b.uid) continue;
        expect(Math.abs(a.frame - b.frame)).toBeGreaterThanOrEqual(SURVIVAL.director.attackGapFrames - tolerance);
        if (a.move === b.move) expect(Math.abs(a.frame - b.frame)).toBeGreaterThanOrEqual(SURVIVAL.director.sameMoveLockFrames - tolerance);
      }
    }
  });

  it('re-sorts front and back after every turn and gives moved-up enemies a grace period', () => {
    const { session } = play(11, 600);
    const s = session.state;
    const sides = () => s.enemies.filter(e => alive(e) && !e.entering).map(e => [e.uid, session.director.side(e.uid)] as const);
    const before = new Map(sides());
    expect(before.size).toBeGreaterThan(1);
    // Double tap against the current facing.
    const back = s.player.facing === 1 ? { left: true } : { right: true };
    for (const input of [raw(back), neutralInput(), raw(back)]) { while (!['Idle', 'Walk'].includes(s.player.state)) session.step(neutralInput()); session.step(input); }
    for (let i = 0; i < SURVIVAL.turn.frames + 1; i++) session.step(neutralInput());
    const after = new Map(sides());
    let flipped = 0;
    for (const [uid, side] of after) if (before.has(uid) && before.get(uid) !== side) flipped++;
    expect(flipped).toBeGreaterThan(0);
    for (const [uid, side] of after) {
      const e = s.enemies.find(x => x.uid === uid)!;
      expect(side).toBe(inFront(s.player, e.fighter) ? 'front' : 'back');
    }
  });

  it('is deterministic for a seed', () => {
    const input = (_: SurvivalState, i: number) => raw({ left: i % 90 < 10 }, i % 37 === 0 ? buttonBit('MP') : 0);
    const a = play(21, 1500, input).session.state, b = play(21, 1500, input).session.state;
    expect(JSON.stringify(snapshotSurvival(a))).toBe(JSON.stringify(snapshotSurvival(b)));
  });
});
