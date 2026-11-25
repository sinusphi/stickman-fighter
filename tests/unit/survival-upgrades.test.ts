import { describe, expect, it } from 'vitest';
import rules from '../../src/data/rules.json';
import { MOVES } from '../../src/data/schema';
import { buttonBit, neutralInput, type RawInput } from '../../src/input/types';
import { knocksDown } from '../../src/simulation/combat';
import { SURVIVAL, survivalTestConfig, type UpgradeId } from '../../src/survival/config';
import { SurvivalSession } from '../../src/survival/session';
import { bossSpec } from '../../src/survival/spawner';
import { createSurvival, spawnEnemy, stepSurvival, type SurvivalState } from '../../src/survival/state';
import { activeUpgrades, availableUpgrades, chooseUpgrade, offerStep, playerMaxHp, upgradeIds } from '../../src/survival/upgrades';
import { CHOICE_LOCK_FRAMES, UpgradeChoice } from '../../src/platform/upgrade-choice';

const U = rules.unit;
const E = SURVIVAL.upgrades.effects;
const raw = (dir: { left?: boolean; right?: boolean } = {}, buttons = 0): RawInput => ({ ...neutralInput(), ...dir, buttons });
const quiet = (seed = 1) => { const s = createSurvival(seed); s.spawnTimer = 1e9; return s; };
function place(s: SurvivalState, offset: number, kind: Parameters<typeof spawnEnemy>[2] = 'rookie') {
  const e = spawnEnemy(s, offset < 0 ? -1 : 1, kind);
  e.entering = false; e.fighter.x = s.player.x + offset * U; e.fighter.facing = offset < 0 ? 1 : -1;
  return e;
}
const run = (s: SurvivalState, frames: number, input: RawInput = neutralInput(), enemies: RawInput[] = []) => { for (let i = 0; i < frames; i++) stepSurvival(s, input, enemies); };
/** Opens a choice right now (as after a boss, waited out) and returns its cards. */
function offerNow(s: SurvivalState): UpgradeId[] | null {
  s.upgrades.dueAt = s.frame - SURVIVAL.upgrades.maxWaitFrames; offerStep(s);
  return s.upgrades.offer;
}
/** Gives the player `n` stacks of an upgrade through the regular pick. */
function grant(s: SurvivalState, id: UpgradeId, n = 1) {
  for (let i = 0; i < n; i++) { s.upgrades.offer = [id]; expect(chooseUpgrade(s, 0)).toBe(id); }
}

describe('survival upgrades: flow', () => {
  it('opens a choice after a fallen boss once the cleanup is over and holds the run', () => {
    const s = quiet(), boss = place(s, 40, bossSpec(SURVIVAL, 1));
    boss.fighter.hp = 1;
    stepSurvival(s, raw({}, buttonBit('LP')));
    run(s, 30);
    expect(boss.dead).toBe(true);
    const due = s.upgrades.dueAt!;
    expect(due).toBe(s.flow.bossDown! + SURVIVAL.duel.cleanupFrames + SURVIVAL.upgrades.delayFrames);
    while (!s.upgrades.offer && s.frame < due + 200) stepSurvival(s, neutralInput());
    expect(s.upgrades.offer).toHaveLength(3);
    expect(s.frame).toBeGreaterThanOrEqual(due);
    expect(s.frame).toBeLessThanOrEqual(due + SURVIVAL.upgrades.maxWaitFrames);
    // Paused: nothing moves, not even the frame counter.
    const frame = s.frame, survived = s.survivedFrames;
    run(s, 50, raw({ right: true }));
    expect([s.frame, s.survivedFrames]).toEqual([frame, survived]);
    expect(chooseUpgrade(s, 1)).toBe(s.upgrades.picks[0]);
    expect(s.upgrades.offer).toBeNull();
    stepSurvival(s, neutralInput());
    expect(s.frame).toBe(frame + 1);
  });

  it('offers nothing when upgrades are switched off', () => {
    const s = createSurvival(1, undefined, { ...SURVIVAL, upgrades: { ...SURVIVAL.upgrades, enabled: false } });
    s.spawnTimer = 1e9;
    const boss = place(s, 40, bossSpec(SURVIVAL, 1));
    boss.fighter.hp = 1;
    stepSurvival(s, raw({}, buttonBit('LP')));
    run(s, 400);
    expect(boss.dead).toBe(true);
    expect(s.upgrades.dueAt).toBeNull();
    expect(s.upgrades.offer).toBeNull();
  });

  it('draws the same cards for the same seed and different ones across seeds', () => {
    const sequence = (seed: number) => {
      const s = quiet(seed), offers: UpgradeId[][] = [];
      for (let i = 0; i < 6; i++) { offers.push([...offerNow(s)!]); chooseUpgrade(s, i % 3); }
      return offers;
    };
    expect(sequence(7)).toEqual(sequence(7));
    const seeds = [1, 2, 3, 4, 5].map(seed => JSON.stringify(sequence(seed)));
    expect(new Set(seeds).size).toBeGreaterThan(1);
    // Three different cards per offer.
    for (const offer of sequence(3)) expect(new Set(offer).size).toBe(offer.length);
  });

  it('keeps the spawns independent of the picks', () => {
    const spawns = (index: number) => {
      const s = createSurvival(5);
      offerNow(s); chooseUpgrade(s, index);
      run(s, 900);
      return s.enemies.map(e => `${e.uid}:${e.archetype}`);
    };
    expect(spawns(0)).toEqual(spawns(2));
  });

  it('respects the stack limits until every upgrade is maxed', () => {
    const s = quiet(9), total = upgradeIds(SURVIVAL).reduce((sum, id) => sum + E[id].max, 0);
    let picks = 0;
    for (let guard = 0; guard < 100; guard++) {
      const offer = offerNow(s);
      if (!offer) break;
      expect(offer.length).toBe(Math.min(SURVIVAL.upgrades.cards, availableUpgrades(s).length));
      for (const id of offer) expect(s.upgrades.stacks[id]).toBeLessThan(E[id].max);
      chooseUpgrade(s, picks % offer.length); picks++;
      for (const id of upgradeIds(SURVIVAL)) expect(s.upgrades.stacks[id]).toBeLessThanOrEqual(E[id].max);
    }
    expect(picks).toBe(total);
    expect(availableUpgrades(s)).toEqual([]);
    expect(s.upgrades.offer).toBeNull();
    expect(activeUpgrades(s).every(u => u.stacks === u.max)).toBe(true);
    // The same upgrade may be picked several times.
    expect(new Set(s.upgrades.picks).size).toBeLessThan(s.upgrades.picks.length);
  });

  it('rejects an invalid pick', () => {
    const s = quiet();
    expect(chooseUpgrade(s, 0)).toBeNull();
    offerNow(s);
    expect(chooseUpgrade(s, 5)).toBeNull();
    expect(s.upgrades.offer).not.toBeNull();
  });

  it('starts without effects: versus defaults on the player', () => {
    const s = quiet();
    expect(s.player.damageScalePermille).toBe(rules.damageScaleUnit);
    expect(s.player.stability).toBeUndefined();
    expect(s.player.resources).toEqual(rules.resources);
    expect(playerMaxHp(s)).toBe(SURVIVAL.player.hp);
  });
});

describe('survival upgrades: effects', () => {
  it('Max energy raises full energy and heals at once', () => {
    const s = quiet();
    s.player.hp = 500;
    grant(s, 'maxEnergy');
    expect(playerMaxHp(s)).toBe(SURVIVAL.player.hp + E.maxEnergy.amount);
    expect(s.player.hp).toBe(500 + E.maxEnergy.heal);
    expect(s.energy.last).toBe(E.maxEnergy.heal);
    // Healing stops at the new full energy.
    s.player.hp = playerMaxHp(s) - 10;
    grant(s, 'maxEnergy');
    expect(s.player.hp).toBe(SURVIVAL.player.hp + 2 * E.maxEnergy.amount);
    // Hit gains may now go above the old full energy.
    s.player.hp = SURVIVAL.player.hp;
    place(s, 40);
    stepSurvival(s, raw({}, buttonBit('LP'))); run(s, 30);
    expect(s.player.hp).toBeGreaterThan(SURVIVAL.player.hp);
  });

  it('Energy gain raises every gain', () => {
    const gained = (stacks: number) => {
      const s = quiet();
      grant(s, 'energyGain', stacks);
      s.player.hp = 500;
      const e = place(s, 40);
      e.fighter.hp = 1;
      stepSurvival(s, raw({}, buttonBit('LP'))); run(s, 30);
      expect(e.dead).toBe(true);
      return s.player.hp - 500;
    };
    const base = gained(0), more = gained(2);
    expect(more).toBeGreaterThan(base);
    expect(Math.abs(more - base * (1 + 2 * E.energyGain.percent / 100))).toBeLessThanOrEqual(2);
  });

  it('Damage raises the damage of strikes', () => {
    const damage = (stacks: number) => {
      const s = quiet();
      grant(s, 'damage', stacks);
      const e = place(s, 40);
      stepSurvival(s, raw({}, buttonBit('LP'))); run(s, 30);
      return SURVIVAL.types.rookie.hp - e.fighter.hp;
    };
    const base = damage(0), more = damage(2);
    expect(base).toBeGreaterThan(0);
    expect(more).toBe(Math.trunc(base * (100 + 2 * E.damage.percent) / 100));
  });

  it('Revenge fills faster from hits taken, Special from hits dealt', () => {
    const taken = (stacks: number) => {
      const s = quiet();
      grant(s, 'revenge', stacks);
      place(s, -30);
      stepSurvival(s, neutralInput(), [raw({}, buttonBit('LP'))]); run(s, 30);
      return s.player.resources.revenge.current;
    };
    const dealt = (stacks: number) => {
      const s = quiet();
      grant(s, 'special', stacks);
      place(s, 40);
      stepSurvival(s, raw({}, buttonBit('HP'))); run(s, 40);
      return s.player.resources.special.current;
    };
    expect(taken(0)).toBeGreaterThan(0);
    expect(taken(3)).toBeGreaterThan(taken(0));
    expect(dealt(0)).toBeGreaterThan(0);
    expect(dealt(3)).toBeGreaterThan(dealt(0));
    const s = quiet();
    grant(s, 'special', 3);
    expect(s.player.resources.special.gainPerBlock).toBeGreaterThanOrEqual(rules.resources.special.gainPerBlock);
    expect(s.player.resources.revenge.gainPerHit).toBe(rules.resources.revenge.gainPerHit);
  });

  it('Guard refunds chip damage and gives energy for a blocked hit', () => {
    const hpAfterBlock = (stacks: number) => {
      const s = quiet();
      grant(s, 'guard', stacks);
      s.player.hp = 500;
      place(s, 30, 'heavy');
      const back = raw({ left: true }), states: string[] = [];
      stepSurvival(s, back, [raw({}, buttonBit('HP'))]);
      for (let i = 0; i < 30; i++) { stepSurvival(s, back); states.push(s.player.state); }
      expect(states).toContain('Blockstun');
      return s.player.hp;
    };
    const plain = hpAfterBlock(0), guarded = hpAfterBlock(E.guard.max);
    expect(plain).toBeLessThan(500);
    // Full refund at the stack limit (2 × 50 %) plus the energy per block.
    expect(guarded - 500).toBeGreaterThanOrEqual(E.guard.energy * E.guard.max - 1);
    expect(guarded - 500).toBeLessThanOrEqual(E.guard.energy * E.guard.max);
  });

  it('Stability holds the Special spin, then the punch-combo finisher, never Revenge', () => {
    const s = quiet(), hit = (id: string, group: string) => knocksDown(MOVES[id], MOVES[id].hitGroups.find(g => g.id === group)!, s.player);
    expect(hit('special_spin', 'front')).toBe(true);
    expect(hit('middle_high_punch_combo', 'punch')).toBe(true);
    grant(s, 'stability');
    expect(s.player.stability).toBe(rules.hitStrength.defaultStability + E.stability.amount);
    expect(hit('special_spin', 'front')).toBe(false);
    expect(hit('middle_high_punch_combo', 'punch')).toBe(true);
    grant(s, 'stability');
    expect(hit('middle_high_punch_combo', 'punch')).toBe(false);
    expect(hit('revenge_combo', 'punch')).toBe(true);
  });

  it('Back sense lengthens the warning of back attackers', () => {
    const firstWarnings = (stacks: number) => {
      const session = new SurvivalSession(1);
      for (let i = 0; i < stacks; i++) { session.state.upgrades.offer = ['backWarning']; session.choose(0); }
      // Warning length at its first frame, per warning.
      const warned = new Set<number>(), first: number[] = [];
      for (let i = 0; i < 3000 && !session.state.over && first.length < 3; i++) {
        session.step(neutralInput());
        for (const e of session.state.enemies) {
          if (e.warn > 0 && !warned.has(e.uid)) { warned.add(e.uid); first.push(e.warn); }
          if (e.warn === 0) warned.delete(e.uid);
        }
      }
      expect(first.length).toBeGreaterThan(0);
      return Math.min(...first);
    };
    const base = firstWarnings(0), longer = firstWarnings(2);
    expect(base).toBe(SURVIVAL.director.backWarningFrames - 1);
    expect(longer).toBe(base + 2 * E.backWarning.frames);
  });

  it('holds new enemy attacks back for a moment after the pick', () => {
    const session = new SurvivalSession(2), s = session.state;
    for (let i = 0; i < 300; i++) session.step(neutralInput());
    offerNow(s);
    expect(session.choosing).toBe(true);
    session.step(neutralInput());
    session.choose(0);
    const until = s.frame + SURVIVAL.upgrades.resumeGraceFrames;
    session.step(neutralInput());
    expect(session.director.throwPause(s.frame)).toBe(true);
    while (s.frame < until) session.step(neutralInput());
    expect(session.director.throwPause(s.frame)).toBe(false);
  });
});

describe('survival upgrades: menu input', () => {
  const LP = buttonBit('LP');
  it('ignores held and early presses, moves the cursor and picks on a new button press', () => {
    const choice = new UpgradeChoice();
    expect(choice.update(raw({}, LP), 3)).toBeNull();
    expect(choice.cursor).toBe(1);
    for (let i = 0; i < CHOICE_LOCK_FRAMES; i++) expect(choice.update(raw({ right: i % 2 === 0 }, i % 2 ? LP : 0), 3)).toBeNull();
    expect(choice.cursor).toBe(1);
    choice.update(neutralInput(), 3);
    choice.update(raw({ left: true }), 3); choice.update(neutralInput(), 3);
    choice.update(raw({ left: true }), 3);
    expect(choice.cursor).toBe(0);
    choice.update(neutralInput(), 3); choice.update(raw({ left: true }), 3);
    expect(choice.cursor).toBe(0);
    choice.update(neutralInput(), 3);
    expect(choice.update(raw({}, LP), 3)).toBe(0);
  });

  it('swallows the confirming button until it is released', () => {
    const choice = new UpgradeChoice();
    choice.picked(raw({}, LP));
    expect(choice.filter(raw({ right: true }, LP)).buttons).toBe(0);
    expect(choice.filter(neutralInput()).buttons).toBe(0);
    expect(choice.filter(raw({}, LP)).buttons).toBe(LP);
  });

  it('closes when the offer is gone', () => {
    const choice = new UpgradeChoice();
    choice.update(neutralInput(), 2);
    expect(choice.update(raw({}, LP), 0)).toBeNull();
    // A new offer starts locked again.
    expect(choice.update(neutralInput(), 3)).toBeNull();
    expect(choice.update(raw({}, LP), 3)).toBeNull();
  });
});

describe('survival upgrades: test switch', () => {
  it('weakens only the first boss timing and hp', () => {
    expect(survivalTestConfig('')).toBe(SURVIVAL);
    const weak = survivalTestConfig('?survival-test=weak-boss');
    expect(weak.boss.hp).toBe(1);
    expect(weak.boss.firstFrames).toBeLessThan(SURVIVAL.boss.firstFrames);
    expect(weak.upgrades).toBe(SURVIVAL.upgrades);
  });
});
