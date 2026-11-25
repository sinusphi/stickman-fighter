import { describe, expect, it } from 'vitest';
import rules from '../../src/data/rules.json';
import { buttonBit, neutralInput, type RawInput } from '../../src/input/types';
import { SURVIVAL } from '../../src/survival/config';
import { SurvivalSession } from '../../src/survival/session';
import { bossSpec, budgetAt, gainFactor, pickType } from '../../src/survival/spawner';
import { chooseUpgrade } from '../../src/survival/upgrades';
import { alive, createSurvival, inFront, random, snapshotSurvival, spawnEnemy, stepSurvival, type Enemy, type SurvivalState } from '../../src/survival/state';

const U = rules.unit, HZ = rules.hz;
const raw = (buttons = 0): RawInput => ({ ...neutralInput(), buttons });
const quiet = () => { const s = createSurvival(1); s.spawnTimer = 1e9; s.flow.bossTimer = 1e9; s.flow.waveTimer = 1e9; return s; };
function place(s: SurvivalState, offset: number, kind: Parameters<typeof spawnEnemy>[2] = 'rookie'): Enemy {
  const e = spawnEnemy(s, offset < 0 ? -1 : 1, kind);
  e.entering = false; e.fighter.x = s.player.x + offset * U; e.fighter.facing = offset < 0 ? 1 : -1;
  return e;
}
const run = (s: SurvivalState, frames: number, input: RawInput = neutralInput()) => { for (let i = 0; i < frames; i++) stepSurvival(s, input); };
const types = Object.keys(SURVIVAL.types) as (keyof typeof SURVIVAL.types)[];
const tierOf = (id: string) => SURVIVAL.types[id as keyof typeof SURVIVAL.types].tier;

/** Landed hits until the enemy goes down. Single: one jab at a time once the enemy stands free. Combo: the three-hit kick combo. */
function hitsUntilFall(combo: boolean): number {
  const s = quiet(), e = place(s, 38);
  let hits = 0, hp = e.fighter.hp, press = false;
  const input = (buttons: number, right = false): RawInput => ({ ...raw(buttons), right });
  if (combo) {
    stepSurvival(s, input(buttonBit('LMK') | buttonBit('MK'), true));
    for (let i = 0; i < 120 && e.fighter.state !== 'Knockdown'; i++) { stepSurvival(s, neutralInput()); if (e.fighter.hp < hp) { hits++; hp = e.fighter.hp; } }
  } else {
    for (let i = 0; i < 2000 && e.fighter.state !== 'Knockdown'; i++) {
      // Close in after the pushback, then jab.
      const far = e.fighter.x - s.player.x > 42 * U && s.player.state !== 'Attack';
      press = !far && s.player.state !== 'Attack' && e.fighter.state === 'Idle' && !press;
      stepSurvival(s, input(press ? buttonBit('LP') : 0, far));
      if (e.fighter.hp < hp) { hits++; hp = e.fighter.hp; }
    }
  }
  expect(e.fighter.state).toBe('Knockdown');
  return hits;
}

describe('survival: enemy types and stagger', () => {
  it('has types from very light to heavy with growing values', () => {
    const by = (tier: string) => types.filter(id => tierOf(id) === tier).map(id => SURVIVAL.types[id]);
    for (const tier of ['light', 'medium', 'heavy']) expect(by(tier).length).toBeGreaterThan(0);
    const order = [...by('light'), ...by('medium'), ...by('heavy')];
    for (let i = 1; i < order.length; i++) {
      expect(order[i].hp).toBeGreaterThan(order[i - 1].hp);
      expect(order[i].poise).toBeGreaterThan(order[i - 1].poise);
      expect(order[i].cost).toBeGreaterThanOrEqual(order[i - 1].cost);
    }
  });

  it('a very light enemy falls after about five single hits and after about three combo hits', () => {
    expect(hitsUntilFall(false)).toBe(5);
    expect(hitsUntilFall(true)).toBe(3);
  });

  it('a heavier type takes more hits', () => {
    const s = quiet(), rookie = place(s, 38), heavy = place(s, -38, 'heavy');
    expect(heavy.poiseMax).toBeGreaterThan(rookie.poiseMax);
    expect(heavy.fighter.hp).toBeGreaterThan(rookie.fighter.hp);
    expect(heavy.fighter.damageScalePermille).toBeGreaterThan(rookie.fighter.damageScalePermille);
  });

  it('stagger recovers when the enemy is left alone', () => {
    const s = quiet(), e = place(s, 38);
    stepSurvival(s, raw(buttonBit('LP'))); run(s, 40);
    expect(e.poise).toBeGreaterThan(0);
    run(s, SURVIVAL.stagger.recoverDelayFrames + e.poiseMax / SURVIVAL.stagger.recoverPerFrame + 10);
    expect(e.poise).toBe(0);
  });
});

describe('survival: difficulty budget and mix', () => {
  const sample = (frames: number, n: number, prep?: (s: SurvivalState) => void) => {
    const counts: Record<string, number> = {};
    for (let seed = 1; seed <= n; seed++) {
      const s = createSurvival(seed); s.survivedFrames = frames;
      // One light and one medium enemy are around, so the mix guarantee does not decide.
      place(s, 100, 'rookie'); place(s, -100, 'fighter'); prep?.(s);
      const id = pickType(s, () => random(s), HZ); counts[tierOf(id)] = (counts[tierOf(id)] ?? 0) + 1;
    }
    return counts;
  };

  it('the budget grows with the run time', () => {
    expect(budgetAt(SURVIVAL, 0, HZ)).toBe(SURVIVAL.budget.start);
    expect(budgetAt(SURVIVAL, 600 * HZ, HZ)).toBeGreaterThan(budgetAt(SURVIVAL, 60 * HZ, HZ));
    expect(budgetAt(SURVIVAL, 1e9, HZ)).toBe(SURVIVAL.budget.cap);
  });

  it('heavier types become more frequent over time', () => {
    const early = sample(0, 300), late = sample(600 * HZ, 300);
    const mid = sample(60 * HZ, 300), share = (c: Record<string, number>) => ((c.medium ?? 0) + (c.heavy ?? 0)) / 300;
    expect(early.heavy ?? 0).toBe(0);
    expect(mid.heavy ?? 0).toBeGreaterThan(0);
    expect(late.heavy ?? 0).toBeGreaterThan(mid.heavy ?? 0);
    expect(share(late)).toBeGreaterThan(share(mid));
    expect(share(mid)).toBeGreaterThan(share(early));
  });

  it('a replacement is preferably of the tier that just fell', () => {
    const none = sample(120 * HZ, 400), light = sample(120 * HZ, 400, s => { s.flow.lastFallen = 'light'; }), medium = sample(120 * HZ, 400, s => { s.flow.lastFallen = 'medium'; });
    expect(light.light).toBeGreaterThan(none.light);
    expect(medium.medium).toBeGreaterThan(none.medium);
  });

  it('an exhausted budget still allows the cheapest light type, never a heavy one', () => {
    const s = createSurvival(1); s.survivedFrames = 10 * HZ;
    for (let i = 0; i < 4; i++) place(s, 100 + i * 70, 'bruiser');
    for (let i = 0; i < 30; i++) expect(tierOf(pickType(s, () => random(s), HZ))).not.toBe('heavy');
  });

  it('a run always has a mix of tiers, and a fallen light enemy is mostly replaced by a light one', () => {
    for (const seed of [1, 2, 3, 4]) {
      const session = new SurvivalSession(seed); const s = session.state;
      for (let i = 0; i < 900; i++) session.step(neutralInput());
      const tiers = new Set(s.enemies.filter(alive).map(e => e.tier));
      expect(tiers.has('light')).toBe(true);
      expect(tiers.has('medium')).toBe(true);
    }
    let light = 0, total = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const session = new SurvivalSession(seed); const s = session.state;
      for (let i = 0; i < 700; i++) session.step(neutralInput());
      const victim = s.enemies.find(e => alive(e) && e.tier === 'light' && e.boss === 0);
      if (!victim) continue;
      const known = new Set(s.enemies.map(e => e.uid));
      victim.fighter.hp = 0; victim.fighter.state = 'KO';
      for (let i = 0; i < 400 && !s.enemies.some(e => !known.has(e.uid)); i++) session.step(neutralInput());
      const next = s.enemies.find(e => !known.has(e.uid)); if (!next) continue;
      total++; if (next.tier === 'light') light++;
    }
    expect(total).toBeGreaterThan(15);
    expect(light / total).toBeGreaterThan(.6);
  });
});

describe('survival: miniboss timer', () => {
  const bosses = (s: SurvivalState) => s.enemies.filter(e => e.boss > 0);

  it('first boss after 30 seconds of run time, never a second one while it lives, the timer pauses', () => {
    const s = createSurvival(2); let first = -1, most = 0;
    for (let i = 0; i < 6000; i++) {
      stepSurvival(s, neutralInput());
      most = Math.max(most, bosses(s).length);
      if (first < 0 && bosses(s).length) first = s.survivedFrames;
    }
    expect(first).toBe(SURVIVAL.boss.firstFrames);
    expect(most).toBe(1);
    expect(s.flow.bosses).toBe(1);
    expect(s.flow.bossTimer).toBe(0);
  });

  it('the next boss comes 45 seconds after the last boss has left, each one tougher', () => {
    const s = createSurvival(3);
    while (!bosses(s).length) stepSurvival(s, neutralInput());
    const b1 = bosses(s)[0];
    expect(b1.boss).toBe(1);
    // While it lives (even for a long time) the timer is stopped.
    run(s, 900); expect(s.flow.bossTimer).toBe(0);
    b1.fighter.hp = 0; b1.fighter.state = 'KO';
    let gone = -1;
    for (let i = 0; i < 400 && gone < 0; i++) { stepSurvival(s, neutralInput()); if (!bosses(s).length) gone = s.survivedFrames; }
    expect(gone).toBeGreaterThan(0);
    expect(s.flow.bossTimer).toBeGreaterThan(SURVIVAL.boss.intervalFrames - 3);
    let second = -1, most = 0;
    let picked = 0;
    for (let i = 0; i < SURVIVAL.boss.intervalFrames + 300 && second < 0; i++) {
      // The upgrade choice after the boss pauses the run; the survived time stands still meanwhile.
      if (s.upgrades.offer) { chooseUpgrade(s, 0); picked++; }
      stepSurvival(s, neutralInput()); most = Math.max(most, bosses(s).length);
      if (bosses(s).length) second = s.survivedFrames;
    }
    expect(Math.abs(second - gone - SURVIVAL.boss.intervalFrames)).toBeLessThanOrEqual(1);
    expect(picked).toBe(1);
    expect(most).toBe(1);
    const b2 = bosses(s)[0];
    expect(b2.boss).toBe(2);
    expect(b2.maxHp).toBeGreaterThan(b1.maxHp);
    expect(b2.poiseMax).toBeGreaterThan(b1.poiseMax);
    expect(b2.fighter.damageScalePermille).toBeGreaterThan(b1.fighter.damageScalePermille);
  });

  it('later bosses keep getting tougher within their limits', () => {
    for (let n = 1; n < 12; n++) {
      const a = bossSpec(SURVIVAL, n), b = bossSpec(SURVIVAL, n + 1);
      expect(b.hp).toBeGreaterThan(a.hp);
      expect(b.damagePermille).toBeGreaterThan(a.damagePermille);
      expect(b.aggression).toBeGreaterThanOrEqual(a.aggression);
      expect(b.reactionFrames).toBeLessThanOrEqual(a.reactionFrames);
    }
    expect(bossSpec(SURVIVAL, 50).aggression).toBeLessThanOrEqual(SURVIVAL.boss.maxAggression);
    expect(bossSpec(SURVIVAL, 50).reactionFrames).toBeGreaterThanOrEqual(SURVIVAL.boss.minReactionFrames);
  });

  it('start time and interval are adjustable', () => {
    const config = { ...SURVIVAL, boss: { ...SURVIVAL.boss, firstFrames: 100, intervalFrames: 200 } };
    const s = createSurvival(1, undefined, config); let first = -1;
    for (let i = 0; i < 300 && first < 0; i++) { stepSurvival(s, neutralInput()); if (s.flow.bosses) first = s.survivedFrames; }
    expect(first).toBe(100);
  });

  it('the boss walks in from the side the player looks at', () => {
    const s = createSurvival(4);
    while (!bosses(s).length) stepSurvival(s, neutralInput());
    expect(bosses(s)[0].fighter.x).toBeGreaterThan(rules.stageWidth);
  });

  it('small waves come between the bosses and only exceed the maximum by the extra slots', () => {
    const s = createSurvival(5); let most = 0, waveSeen = false;
    for (let i = 0; i < SURVIVAL.boss.firstFrames - 10; i++) {
      stepSurvival(s, neutralInput());
      most = Math.max(most, s.enemies.filter(e => alive(e) && !e.boss).length);
      if (s.flow.waveLeft > 0) waveSeen = true;
    }
    expect(waveSeen).toBe(true);
    expect(most).toBeGreaterThan(SURVIVAL.enemies.max);
    expect(most).toBeLessThanOrEqual(SURVIVAL.enemies.max + SURVIVAL.waves.extraSlots);
  });
});

describe('survival: director states around the boss', () => {
  /** Attack starts of every enemy, with director mode and boss flag. */
  function watch(session: SurvivalSession, frames: number, log: { frame: number; boss: boolean; mode: string }[], seen = new Map<number, number>()) {
    for (let i = 0; i < frames; i++) {
      session.step(neutralInput());
      for (const e of session.state.enemies) if (e.fighter.state === 'Attack' && e.fighter.moveFrame === 0 && seen.get(e.uid) !== e.fighter.attackId) {
        seen.set(e.uid, e.fighter.attackId); log.push({ frame: session.state.frame, boss: e.boss > 0, mode: session.director.mode });
      }
    }
  }
  const start = (seed: number) => { const session = new SurvivalSession(seed); while (!session.state.enemies.some(e => e.boss > 0 && !e.entering)) session.step(neutralInput()); return session; };

  it('during the duel only the boss attacks, spectators hold no token', () => {
    for (const seed of [1, 2, 3]) {
      const session = start(seed), log: { frame: number; boss: boolean; mode: string }[] = [], s = session.state;
      // Let attacks that began before the duel play out.
      for (let i = 0; i < 40; i++) session.step(neutralInput());
      let spectatorTokens = 0, duelFrames = 0;
      const seen = new Map<number, number>();
      for (let i = 0; i < 900; i++) {
        watch(session, 1, log, seen);
        if (session.director.mode !== 'duel') continue;
        duelFrames++;
        for (const e of s.enemies) if (!e.boss && session.director.token(e.uid)) spectatorTokens++;
      }
      const duelAttacks = log.filter(l => l.mode === 'duel');
      expect(duelFrames).toBeGreaterThan(600);
      expect(duelAttacks.length).toBeGreaterThan(0);
      expect(duelAttacks.every(l => l.boss)).toBe(true);
      expect(spectatorTokens).toBe(0);
    }
  });

  it('after the boss fell the waiting enemies get attack rights and attack soon', () => {
    for (const seed of [1, 2, 3]) {
      const session = start(seed), s = session.state;
      for (let i = 0; i < 300; i++) session.step(neutralInput());
      expect(session.director.mode).toBe('duel');
      const boss = s.enemies.find(e => e.boss > 0)!;
      boss.fighter.hp = 0; boss.fighter.state = 'KO';
      session.step(neutralInput()); session.step(neutralInput());
      expect(session.director.mode).toBe('cleanup');
      const log: { frame: number; boss: boolean; mode: string }[] = [], fallen = s.frame;
      let most = 0;
      for (let i = 0; i < SURVIVAL.duel.cleanupFrames; i++) {
        watch(session, 1, log);
        most = Math.max(most, s.enemies.filter(e => session.director.token(e.uid) === 'front').length);
      }
      const first = log.find(l => !l.boss);
      expect(first).toBeDefined();
      expect(first!.frame - fallen).toBeLessThan(SURVIVAL.duel.cleanupFrames * .7);
      expect(most).toBeLessThanOrEqual(SURVIVAL.director.frontTokens + SURVIVAL.duel.cleanupExtraTokens);
      for (let i = 0; i < 60; i++) session.step(neutralInput());
      expect(session.director.mode).toBe('normal');
    }
  });
});

describe('survival: energy rewards', () => {
  const U1 = SURVIVAL.energy;

  it('gives a small gain per landed hit, more inside a combo, none when blocked', () => {
    const s = quiet(), e = place(s, 38); s.player.hp = 500;
    stepSurvival(s, raw(buttonBit('LP'))); run(s, 12);
    expect(e.fighter.hp).toBeLessThan(e.maxHp);
    expect(s.player.hp).toBe(500 + U1.perHit);
    expect(s.energy.total).toBe(U1.perHit);
  });

  it('a kill gives the type bonus, the boss bonus goes beyond full energy but not over the cap', () => {
    const s = quiet(), e = place(s, 38, 'brawler'); s.player.hp = 400;
    e.fighter.hp = 0; e.fighter.state = 'KO'; stepSurvival(s, neutralInput());
    expect(s.player.hp).toBe(400 + SURVIVAL.types.brawler.killEnergy);
    const boss = place(s, -60, bossSpec(SURVIVAL, 1)); s.player.hp = SURVIVAL.player.hp - 10;
    boss.fighter.hp = 0; boss.fighter.state = 'KO'; stepSurvival(s, neutralInput());
    expect(s.player.hp).toBe(SURVIVAL.player.hp - 10 + SURVIVAL.boss.killEnergy);
    expect(s.player.hp).toBeGreaterThan(SURVIVAL.player.hp);
    // Small gains never exceed full energy, even from an overfull reserve.
    s.player.hp = SURVIVAL.player.hp + 100;
    const e2 = place(s, 38); e2.fighter.hp = 0; e2.fighter.state = 'KO'; stepSurvival(s, neutralInput());
    expect(s.player.hp).toBe(SURVIVAL.player.hp + 100);
    s.player.hp = SURVIVAL.energy.reserveCap - 5;
    const boss2 = place(s, -60, bossSpec(SURVIVAL, 2)); boss2.fighter.hp = 0; boss2.fighter.state = 'KO'; stepSurvival(s, neutralInput());
    expect(s.player.hp).toBe(SURVIVAL.energy.reserveCap);
  });

  it('gains shrink slowly with the run time, never below the floor', () => {
    expect(gainFactor(SURVIVAL, 0, HZ)).toBe(1);
    expect(gainFactor(SURVIVAL, 300 * HZ, HZ)).toBeLessThan(1);
    expect(gainFactor(SURVIVAL, 300 * HZ, HZ)).toBeGreaterThan(SURVIVAL.energy.decay.floor);
    expect(gainFactor(SURVIVAL, 1e9, HZ)).toBe(SURVIVAL.energy.decay.floor);
    const s = quiet(); s.survivedFrames = 10 * 60 * HZ; s.player.hp = 500;
    const e = place(s, 38, 'brawler'); e.fighter.hp = 0; e.fighter.state = 'KO'; stepSurvival(s, neutralInput());
    expect(s.player.hp - 500).toBe(Math.round(SURVIVAL.types.brawler.killEnergy * SURVIVAL.energy.decay.floor));
  });

  it('no energy once the run is over', () => {
    const s = quiet(), e = place(s, 38); s.player.hp = 0; s.player.state = 'KO';
    e.fighter.hp = 0; e.fighter.state = 'KO'; stepSurvival(s, neutralInput());
    expect(s.player.hp).toBe(0);
  });
});

describe('survival: full run with boss', () => {
  it('is deterministic over the first boss fight', () => {
    const input = (i: number): RawInput => ({ ...neutralInput(), left: i % 90 < 10, buttons: i % 37 === 0 ? buttonBit('MP') : 0 });
    const play = () => { const session = new SurvivalSession(31); for (let i = 0; i < 2700 && !session.state.over; i++) session.step(input(i)); return session; };
    const a = play(), b = play();
    expect(a.state.flow.bosses).toBeGreaterThan(0);
    expect(JSON.stringify(snapshotSurvival(a.state))).toBe(JSON.stringify(snapshotSurvival(b.state)));
    expect(inFront(a.state.player, a.state.enemies[0]?.fighter ?? a.state.player)).toBeTypeOf('boolean');
  });
});
