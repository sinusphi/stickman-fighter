import { describe, expect, it } from 'vitest';
import rules from '../../src/data/rules.json';
import { createGame, snapshot, step } from '../../src/simulation/state';
import { buttonBit, neutralInput, type RawInput } from '../../src/input/types';
import type { GameState } from '../../src/simulation/types';
import { COMBO_FADE_STEPS, HitEffects, MAX_PARTICLES, MAX_SHAKE, ParticleKind, SHAKE_DECAY, Tint, shakeForHit, type SparkSpec } from '../../src/render/effects';
import { newResourceFills, READY_STAGGER_STEPS } from '../../src/platform/resource-ready';
import { EFFECTS_STORAGE_KEY, SHAKE_STORAGE_KEY, loadEffectSettings, saveEffectSettings } from '../../src/platform/effects-settings';

const spec = (overrides: Partial<SparkSpec> = {}): SparkSpec => ({ x: 400, y: 250, side: 1, weight: .5, level: 'MID', kind: 'kick', blocked: false, damage: 65, ...overrides });
const sparks = (overrides: Partial<SparkSpec>) => {
  const effects = new HitEffects(); effects.spawnSparks(spec(overrides));
  const list = effects.particles();
  return { list, rays: list.filter(p => p.kind === ParticleKind.Ray), size: Math.max(...list.map(p => p.size)) };
};
const forward = (facing: number, buttons = 0): RawInput => ({ ...neutralInput(), right: facing === 1, left: facing === -1, buttons });
function close(distance = 45): GameState {
  const game = createGame(), [a, b] = game.fighters;
  a.x = 450 * rules.unit; b.x = a.x + distance * rules.unit;
  a.facing = a.attackFacing = 1; b.facing = b.attackFacing = -1;
  return game;
}
/** Runs the simulation and feeds every step to the effects, as main.ts does. */
function play(game: GameState, effects: HitEffects, frames: number, input: (frame: number) => [RawInput, RawInput]): void {
  for (let frame = 0; frame < frames; frame++) {
    const previous = snapshot(game);
    step(game, input(frame));
    effects.update(game, previous);
  }
}

describe('hit sparks', () => {
  it('grow from LOW over MID to HIGH and with damage weight', () => {
    const low = sparks({ level: 'LOW' }), mid = sparks({ level: 'MID' }), high = sparks({ level: 'HIGH' });
    expect(low.size).toBeLessThan(mid.size);
    expect(mid.size).toBeLessThan(high.size);
    expect(sparks({ weight: 1 }).rays.length).toBeGreaterThan(sparks({ weight: 0 }).rays.length);
    expect(sparks({ weight: 1 }).size).toBeGreaterThan(sparks({ weight: 0 }).size);
  });
  it('distinguish punches (compact star) from kicks (longer fan)', () => {
    expect(sparks({ kind: 'punch' }).rays.length).toBeLessThan(sparks({ kind: 'kick' }).rays.length);
  });
  it('give blocked strikes a smaller, muted burst with a guard arc', () => {
    const hit = sparks({}), blocked = sparks({ blocked: true });
    expect(blocked.rays.length).toBeLessThan(hit.rays.length);
    expect(blocked.size).toBeLessThan(hit.size);
    expect(blocked.list.every(p => p.tint === Tint.Muted)).toBe(true);
    expect(blocked.list.some(p => p.kind === ParticleKind.Arc)).toBe(true);
    expect(hit.list.some(p => p.tint === Tint.Muted)).toBe(false);
    expect(hit.list.some(p => p.kind === ParticleKind.Arc)).toBe(false);
  });
  it('heavy and HIGH hits add accent streaks', () => {
    expect(sparks({ damage: 95 }).list.some(p => p.tint === Tint.Revenge)).toBe(true);
    expect(sparks({ damage: 30, level: 'LOW' }).list.some(p => p.tint === Tint.Revenge)).toBe(false);
  });
  it('never exceed the pool limit', () => {
    const effects = new HitEffects();
    for (let i = 0; i < 200; i++) effects.spawnSparks(spec({ weight: 1 }));
    expect(effects.activeCount()).toBe(MAX_PARTICLES);
    expect(effects.particles()).toHaveLength(MAX_PARTICLES);
  });
  it('spawn at a real contact and fade out within half a second of steps', () => {
    const game = close(), effects = new HitEffects();
    play(game, effects, 12, frame => [frame === 0 ? { ...neutralInput(), buttons: buttonBit('MP') } : neutralInput(), neutralInput()]);
    expect(game.fighters[0].hitTargets).toEqual(['main:1']);
    expect(effects.particles().some(p => p.kind === ParticleKind.Ray)).toBe(true);
    // Contact sits between both fighters, above the floor.
    const flash = effects.particles().find(p => p.kind === ParticleKind.Flash)!;
    expect(flash.x).toBeGreaterThan(game.fighters[0].x / rules.unit);
    expect(flash.x).toBeLessThan(game.fighters[1].x / rules.unit);
    play(game, effects, 30, () => [neutralInput(), neutralInput()]);
    expect(effects.particles().some(p => p.kind === ParticleKind.Ray)).toBe(false);
  });
});

describe('screen shake', () => {
  it('is reserved for heavy hits, scales with damage and stays tiny on block', () => {
    expect(shakeForHit(30, false)).toBe(0);
    expect(shakeForHit(110, false)).toBeGreaterThan(shakeForHit(85, false));
    expect(shakeForHit(110, true)).toBeLessThan(shakeForHit(110, false) * .2);
  });
  it('decays deterministically and identically after a reset', () => {
    const run = (effects: HitEffects) => {
      effects.addShake(5);
      const game = createGame(), trace: number[] = [];
      for (let i = 0; i < 12; i++) { effects.update(game, snapshot(game)); trace.push(effects.shake, effects.camera(false)?.x ?? 0); }
      return trace;
    };
    const a = new HitEffects(), b = new HitEffects();
    const first = run(a);
    expect(first).toEqual(run(b));
    expect(first[0]).toBeCloseTo(5 * SHAKE_DECAY, 10);
    expect(first[6]).toBeCloseTo(5 * SHAKE_DECAY ** 4, 10);
    a.reset();
    expect(run(a)).toEqual(first);
    for (let i = 0; i < 60; i++) a.update(createGame(), createGame());
    expect(a.shake).toBe(0);
    expect(a.camera(false)).toBeNull();
  });
  it('is capped and disabled by the setting or while paused', () => {
    const effects = new HitEffects({ effects: true, shake: true });
    effects.addShake(100); expect(effects.shake).toBe(MAX_SHAKE);
    effects.update(createGame(), createGame());
    expect(effects.camera(false)).not.toBeNull();
    expect(effects.camera(true)).toBeNull();
    effects.settings.shake = false;
    expect(effects.camera(false)).toBeNull();
  });
  it('shakes, flashes and zooms on a KO', () => {
    const game = close(), effects = new HitEffects();
    game.fighters[1].hp = 20;
    play(game, effects, 2, frame => [frame === 0 ? { ...neutralInput(), buttons: buttonBit('LP') } : neutralInput(), neutralInput()]);
    play(game, effects, 10, () => [neutralInput(), neutralInput()]);
    expect(game.fighters[1].state).toBe('KO');
    expect(effects.flash).toBeGreaterThan(0);
    expect(effects.camera(false)!.zoom).toBeGreaterThan(1.05);
  });
});

describe('ground reactions', () => {
  it('raise dust and an impact ring on landing', () => {
    // Particles live only briefly, so look at every step around the landing.
    const landing = createGame(), seen = new HitEffects();
    let dust = false, ring = false;
    for (let frame = 0; frame < 80; frame++) {
      const previous = snapshot(landing);
      step(landing, [frame < 2 ? { ...neutralInput(), up: true } : neutralInput(), neutralInput()]);
      seen.update(landing, previous);
      dust ||= seen.particles().some(p => p.kind === ParticleKind.Dust);
      ring ||= seen.particles().some(p => p.kind === ParticleKind.Ring);
    }
    expect(landing.fighters[0].y).toBe(0);
    expect(dust && ring).toBe(true);
  });
  it('kicks up dust when a finisher pushes the opponent back', () => {
    const game = close(), effects = new HitEffects();
    let dust = 0;
    for (let frame = 0; frame < 40; frame++) {
      const previous = snapshot(game);
      step(game, [frame === 0 ? { ...neutralInput(), buttons: buttonBit('HP') } : neutralInput(), neutralInput()]);
      effects.update(game, previous);
      dust = Math.max(dust, effects.particles().filter(p => p.kind === ParticleKind.Dust).length);
    }
    expect(game.fighters[0].hitTargets).toEqual(['main:1']);
    expect(dust).toBeGreaterThan(0);
  });
});

describe('combo counter', () => {
  const chord = (id: 'middle_high_punch_combo' | 'tornado_spin_combo' | 'punch_kick_combo') =>
    ({ middle_high_punch_combo: buttonBit('HK') | buttonBit('RHK'), tornado_spin_combo: buttonBit('MK') | buttonBit('HK'), punch_kick_combo: buttonBit('MP') | buttonBit('RHK') })[id];
  it.each([['middle_high_punch_combo', 5, 370], ['tornado_spin_combo', 2, 180], ['punch_kick_combo', 2, 150]] as const)('counts every hit of %s and its damage', (id, hits, damage) => {
    const game = close(id === 'tornado_spin_combo' ? 60 : 40), effects = new HitEffects();
    let best = 0;
    for (let frame = 0; frame < 160; frame++) {
      const previous = snapshot(game);
      step(game, [frame === 0 ? forward(1, chord(id)) : neutralInput(), neutralInput()]);
      effects.update(game, previous);
      const combo = effects.combo(0);
      if (combo && combo.count >= best) { best = combo.count; if (combo.count === hits) expect(combo.damage).toBe(damage); }
    }
    expect(best).toBe(hits);
  });
  it('pops on a new hit, ends once the opponent may act and fades out', () => {
    const game = close(40), effects = new HitEffects();
    let popped = false, faded = false, endedWhileStunned = false;
    for (let frame = 0; frame < 160; frame++) {
      const previous = snapshot(game);
      step(game, [frame === 0 ? forward(1, chord('punch_kick_combo')) : neutralInput(), neutralInput()]);
      effects.update(game, previous);
      const combo = effects.combo(0);
      if (combo?.pop === 1) popped = true;
      if (combo && combo.alpha < 1 && game.fighters[1].state === 'Hitstun') endedWhileStunned = true;
      if (combo && combo.alpha < 1) faded = true;
    }
    expect(popped && faded).toBe(true);
    expect(endedWhileStunned).toBe(false);
    // Fully faded after COMBO_FADE_STEPS.
    expect(effects.combo(0)).toBeNull();
    expect(COMBO_FADE_STEPS).toBeLessThan(100);
  });
  it('ignores single hits and blocked strings', () => {
    const blocked = close(40), effects = new HitEffects();
    blocked.fighters[1].x = rules.stageWidth - 26 * rules.unit; blocked.fighters[0].x = blocked.fighters[1].x - 45 * rules.unit;
    for (let frame = 0; frame < 120; frame++) {
      const previous = snapshot(blocked);
      // MID jab blocked low, HIGH kick blocked standing.
      const guard = { ...neutralInput(), right: true, down: blocked.fighters[0].hitTargets.length === 0 };
      step(blocked, [frame === 0 ? forward(1, chord('punch_kick_combo')) : neutralInput(), guard]);
      effects.update(blocked, previous);
      expect(effects.combo(0)).toBeNull();
    }
    expect(blocked.fighters[0].hitTargets).toHaveLength(2);
  });
});

describe('presentation boundaries', () => {
  it('never changes the game state it observes', () => {
    const game = close(40), effects = new HitEffects();
    for (let frame = 0; frame < 120; frame++) {
      const previous = snapshot(game);
      step(game, [frame === 0 ? forward(1, buttonBit('MP') | buttonBit('RHK')) : neutralInput(), neutralInput()]);
      const before = snapshot(game), old = snapshot(previous);
      effects.update(game, previous);
      expect(game).toEqual(before);
      expect(previous).toEqual(old);
    }
  });
  it('stands still while paused but still registers new contacts', () => {
    const effects = new HitEffects();
    effects.spawnSparks(spec());
    const frozen = effects.particles();
    effects.update(createGame(), createGame(), false);
    expect(effects.particles()).toEqual(frozen);
    effects.update(createGame(), createGame(), true);
    expect(effects.particles()).not.toEqual(frozen);
  });
  it('reset clears particles, shake, flash and counters', () => {
    const game = close(40), effects = new HitEffects();
    play(game, effects, 36, frame => [frame === 0 ? forward(1, buttonBit('MP') | buttonBit('RHK')) : neutralInput(), neutralInput()]);
    effects.spawnSparks(spec()); effects.addShake(4); effects.flash = 1;
    expect(effects.activeCount()).toBeGreaterThan(0);
    expect(effects.combo(0)).not.toBeNull();
    effects.reset();
    expect(effects.activeCount()).toBe(0);
    expect([effects.shake, effects.flash]).toEqual([0, 0]);
    expect(effects.combo(0)).toBeNull();
    expect(effects.camera(false)).toBeNull();
  });
});

describe('effect settings', () => {
  const memory = (values: Record<string, string> = {}) => ({ values, getItem: (key: string) => values[key] ?? null, setItem: (key: string, value: string) => { values[key] = value; } });
  it('defaults to everything on, without camera motion for reduced motion', () => {
    expect(loadEffectSettings(memory(), false)).toEqual({ effects: true, shake: true });
    expect(loadEffectSettings(memory(), true)).toEqual({ effects: true, shake: false });
  });
  it('stores choices that win over the reduced-motion default', () => {
    const storage = memory();
    expect(saveEffectSettings({ effects: false, shake: true }, storage)).toBe(true);
    expect(storage.values).toEqual({ [EFFECTS_STORAGE_KEY]: 'off', [SHAKE_STORAGE_KEY]: 'on' });
    expect(loadEffectSettings(storage, true)).toEqual({ effects: false, shake: true });
  });
  it('survives storage that throws', () => {
    const broken = { getItem: () => { throw Error('denied'); }, setItem: () => { throw Error('denied'); } };
    expect(loadEffectSettings(broken, true)).toEqual({ effects: true, shake: false });
    expect(saveEffectSettings({ effects: true, shake: true }, broken)).toBe(false);
  });
});

describe('bar full (Revenge / Special)', () => {
  const fill = (game: GameState, fighter: number, name: 'revenge' | 'special', current: number) => { game.fighters[fighter].resources[name].current = current; };
  const observe = (effects: HitEffects, game: GameState, previous: GameState) => { const before = snapshot(game); effects.update(game, previous); return before; };
  it('fires once on the transition to full, per fighter and per bar', () => {
    const previous = createGame(); fill(previous, 1, 'special', 95);
    const game = snapshot(previous); fill(game, 1, 'special', 100);
    expect(newResourceFills(game, previous)).toEqual([{ fighter: 1, resource: 'special', delay: 0 }]);
    const effects = new HitEffects(); effects.update(game, previous);
    expect(effects.readyEventCount(1, 'special')).toBe(1);
    expect([effects.readyEventCount(0, 'special'), effects.readyEventCount(0, 'revenge'), effects.readyEventCount(1, 'revenge')]).toEqual([0, 0, 0]);
    const list = effects.particles();
    expect(list.some(p => p.kind === ParticleKind.Halo)).toBe(true);
    expect(list.some(p => p.kind === ParticleKind.Aura)).toBe(true);
    expect(list.filter(p => p.kind === ParticleKind.Star).length).toBeGreaterThan(4);
    expect(list.every(p => p.tint === Tint.Special || p.tint === Tint.Light)).toBe(true);
    // Centred on P2, not P1.
    const x = game.fighters[1].x / rules.unit;
    expect(list.filter(p => p.kind === ParticleKind.Halo).every(p => p.x === x)).toBe(true);
    // The bar stays full: no second burst, no shake.
    const again = snapshot(game); effects.update(again, game);
    expect(effects.readyEventCount(1, 'special')).toBe(1);
    expect(effects.shake).toBe(0);
  });
  it('distinguishes Revenge (fast red-orange sparks) from Special (calm ring and stars)', () => {
    const revenge = new HitEffects(); revenge.spawnReadyBurst(400, 250, 'revenge');
    const special = new HitEffects(); special.spawnReadyBurst(400, 250, 'special');
    const r = revenge.particles(), s = special.particles();
    expect(r.some(p => p.kind === ParticleKind.Spark) && !r.some(p => p.kind === ParticleKind.Star)).toBe(true);
    expect(s.some(p => p.kind === ParticleKind.Star) && !s.some(p => p.kind === ParticleKind.Spark)).toBe(true);
    expect(r.filter(p => p.kind !== ParticleKind.Halo || p.tint !== Tint.Light).every(p => p.tint === Tint.Revenge || p.tint === Tint.Light)).toBe(true);
    // Revenge sparks rise faster than the Special stars.
    const rise = (effects: HitEffects, kind: ParticleKind) => { const y0 = effects.particles().filter(p => p.kind === kind).map(p => p.y); effects.update(createGame(), createGame()); return effects.particles().filter(p => p.kind === kind).map((p, i) => y0[i] - p.y); };
    expect(Math.min(...rise(revenge, ParticleKind.Spark))).toBeGreaterThan(Math.max(...rise(special, ParticleKind.Star)));
  });
  it('ignores bars that are already full, including the round change where resources carry over', () => {
    const game = createGame();
    for (const f of game.fighters) { fill(game, f.id, 'revenge', 100); fill(game, f.id, 'special', 100); }
    game.round = { ...game.round, phase: 'roundOver', transition: 1, winner: 0, reason: 'KO', wins: [1, 0] };
    const effects = new HitEffects(), previous = snapshot(game);
    step(game);
    expect(game.round).toMatchObject({ phase: 'fighting', number: 2 });
    expect(game.fighters.map(f => [f.resources.revenge.current, f.resources.special.current])).toEqual([[100, 100], [100, 100]]);
    effects.update(game, previous);
    expect(newResourceFills(game, previous)).toEqual([]);
    expect(effects.activeCount()).toBe(0);
  });
  it('staggers two bars that fill in the same step', () => {
    const previous = createGame(); fill(previous, 0, 'revenge', 99); fill(previous, 0, 'special', 98);
    const game = snapshot(previous); fill(game, 0, 'revenge', 100); fill(game, 0, 'special', 100);
    expect(newResourceFills(game, previous)).toEqual([{ fighter: 0, resource: 'revenge', delay: 0 }, { fighter: 0, resource: 'special', delay: READY_STAGGER_STEPS }]);
    const effects = new HitEffects(); effects.update(game, previous);
    expect(effects.particles().some(p => p.kind === ParticleKind.Spark)).toBe(true);
    expect(effects.particles().some(p => p.kind === ParticleKind.Star)).toBe(false);
    for (let i = 0; i < READY_STAGGER_STEPS - 1; i++) effects.update(game, game);
    expect(effects.particles().some(p => p.kind === ParticleKind.Star)).toBe(false);
    effects.update(game, game);
    expect(effects.particles().some(p => p.kind === ParticleKind.Star)).toBe(true);
  });
  it('stays inside the particle pool, never writes the game state and spawns nothing with effects off', () => {
    const effects = new HitEffects();
    for (let i = 0; i < 40; i++) { effects.spawnReadyBurst(300, 200, 'revenge'); effects.spawnReadyBurst(300, 200, 'special'); }
    expect(effects.activeCount()).toBe(MAX_PARTICLES);
    const previous = createGame(); fill(previous, 0, 'revenge', 90);
    const game = snapshot(previous); fill(game, 0, 'revenge', 100);
    const before = observe(new HitEffects(), game, previous);
    expect(game).toEqual(before);
    const off = new HitEffects({ effects: false, shake: true });
    off.update(game, previous);
    expect(off.activeCount()).toBe(0);
    expect(off.readyEventCount(0, 'revenge')).toBe(1);
  });
  it('fires from real gameplay and identically when the same steps are replayed', () => {
    const run = () => {
      const game = close(), effects = new HitEffects();
      game.training.enabled = true;
      fill(game, 1, 'revenge', 97);
      play(game, effects, 40, frame => [frame === 0 ? { ...neutralInput(), buttons: buttonBit('LP') } : neutralInput(), neutralInput()]);
      return { effects, game };
    };
    const a = run(), b = run();
    expect(a.game.fighters[1].resources.revenge.current).toBe(100);
    expect(a.effects.readyEventCount(1, 'revenge')).toBe(1);
    expect(a.effects.particles()).toEqual(b.effects.particles());
  });
});
