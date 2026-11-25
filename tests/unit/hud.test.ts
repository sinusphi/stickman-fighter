import { describe, expect, it } from 'vitest';
import { createGame } from '../../src/simulation/state';
import { Hud, hudLabels, hudModes, type HudContext } from '../../src/platform/hud';

const idle = { kind: 'wait', score: 0, reason: 'observe' } as const;
function context(overrides: Partial<HudContext> = {}): HudContext {
  return {
    game: createGame(), paused: false, muted: false,
    cpu: { enabled: false, demo: false, difficulty: 'medium', playerOneDifficulty: 'medium', humanSide: 0 } as HudContext['cpu'],
    cpuDebug: [idle, idle], playback: null, recordingFrames: null, replayFrames: 0,
    show: { boxes: false, inputs: false, states: false }, stageCaption: 'THE DOJO', ...overrides,
  };
}

class FakeElement {
  writes = 0; attributes = new Map<string, string>(); style = { width: '' }; dataset: Record<string, string> = {};
  disabled = false; hidden = false; private content = ''; parentElement: FakeElement | null = null; firstElementChild: FakeElement | null = null;
  get textContent(): string { return this.content; }
  set textContent(value: string) { this.content = value; this.writes++; }
  get innerHTML(): string { return this.content; }
  set innerHTML(value: string) { this.content = value; this.writes++; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); this.writes++; }
  classes = new Set<string>(); flashes = 0; offsetWidth = 0;
  classList = {
    add: (name: string) => { if (name === 'resource-flash') this.flashes++; this.classes.add(name); },
    remove: (name: string) => { this.classes.delete(name); },
    toggle: (name: string, on: boolean) => { if (on) this.classes.add(name); else this.classes.delete(name); },
  };
}
function fakeDocument() {
  const elements = new Map<string, FakeElement>();
  const getElementById = (id: string) => {
    let element = elements.get(id);
    if (!element) { element = new FakeElement(); element.parentElement = new FakeElement(); element.firstElementChild = new FakeElement(); elements.set(id, element); }
    return element;
  };
  return { elements, document: { getElementById } as unknown as Document };
}

describe('HUD', () => {
  it('derives modes and labels without touching the DOM', () => {
    expect(hudModes(context())).toEqual({ trainingCpu: false, cpuActive: false, demoActive: false, cpuPresent: false, cpuSide: 1 });
    const vsCpu = context({ cpu: { enabled: true, demo: false, difficulty: 'medium', playerOneDifficulty: 'medium', humanSide: 0 } as HudContext['cpu'] });
    expect(hudModes(vsCpu).cpuActive).toBe(true);
    expect(hudLabels(vsCpu).p2).toBe('CPU');
    const asP2 = context({ cpu: { enabled: true, demo: false, difficulty: 'medium', playerOneDifficulty: 'hard', humanSide: 1 } });
    expect(hudModes(asP2).cpuSide).toBe(0);
    expect(hudLabels(asP2).p1).toBe('CPU');
    expect(hudLabels(asP2).p2).toBe('PLAYER 02');
    expect(hudLabels(asP2).matchStatus).toContain('VS CPU · ' + hudLabels(asP2).cpuLevel);
    expect(hudLabels(context({ playback: { index: 3, total: 9 } })).arenaMode).toBe('REPLAY / 3 : 9');
    expect(hudLabels(context({ recordingFrames: 12 })).arenaMode).toBe('REC / 12 FRAMES');
    expect(hudLabels(context()).arenaMode).toBe('THE DOJO / LOCAL 1V1');
  });

  it('writes an element only when its value changed', () => {
    const { elements, document } = fakeDocument();
    const hud = new Hud(document), c = context();
    hud.update(c);
    const total = () => [...elements.values()].reduce((sum, element) => sum + element.writes, 0);
    const first = total();
    expect(first).toBeGreaterThan(0);
    hud.update(c);
    expect(total()).toBe(first);
    c.game.fighters[1].hp -= 30;
    hud.update(c);
    expect(elements.get('hp-1')!.textContent).toBe(`${c.game.fighters[1].hp} / 1000`);
    expect(elements.get('wins-0')!.writes).toBe(1);
    hud.invalidate(); hud.update(c);
    expect(elements.get('wins-0')!.writes).toBe(2);
  });
  it('marks the HUD as survival so the longer run time gets its own timer size', () => {
    const { elements, document } = fakeDocument(), hud = new Hud(document);
    const survival = { time: '100:00', best: '100:00', enemies: 1, kills: 0, playerMaxHp: 1000, enemyMaxHp: 520, bossIn: '1:00', boss: 0, energy: 0 };
    hud.update(context({ survival }));
    expect(elements.get('hud')!.classes.has('is-survival')).toBe(true);
    expect(elements.get('timer')!.textContent).toBe('100:00');
    hud.update(context());
    expect(elements.get('hud')!.classes.has('is-survival')).toBe(false);
  });
  it('names the survival player by its controls slot and shows only its own auto block', () => {
    const survival = { time: '0:00', best: '0:00', enemies: 1, kills: 0, playerMaxHp: 1000, enemyMaxHp: 1000, bossIn: '1:00', boss: 0, energy: 0 };
    expect(hudLabels(context({ survival })).p1).toBe('PLAYER 01');
    expect(hudLabels(context({ survival: { ...survival, side: 1 } })).p1).toBe('PLAYER 02');
    const { elements, document } = fakeDocument();
    const game = createGame(); game.inputConfig.autoBlock = [true, false];
    new Hud(document).update(context({ game, survival: { ...survival, side: 1 } }));
    expect(elements.get('auto-block')!.attributes.get('aria-pressed')).toBe('true');
  });
});

describe('HUD bar full', () => {
  const full = (game: ReturnType<typeof createGame>, fighter: number, name: 'revenge' | 'special', current = 100) => { game.fighters[fighter].resources[name].current = current; };
  it('shows READY and a static highlight while full, pulses only with effects and removes everything when the bar sinks', () => {
    const { elements, document } = fakeDocument(), hud = new Hud(document), game = createGame();
    let events = 0;
    const ready = (effects = true) => ({ effects, events: (f: number, r: string) => f === 0 && r === 'revenge' ? events : 0 });
    hud.update(context({ game, ready: ready() }));
    const track = elements.get('resource-0-revenge')!, label = elements.get('resource-ready-0-revenge')!;
    expect(track.classes.has('is-full')).toBe(false);
    expect(label.classes.has('is-visible')).toBe(false);
    full(game, 0, 'revenge'); events = 1;
    hud.update(context({ game, ready: ready() }));
    expect([...track.classes].sort()).toEqual(['is-full', 'is-pulsing', 'resource-flash']);
    expect(label.classes.has('is-visible')).toBe(true);
    expect(track.flashes).toBe(1);
    // Holding the full bar never flashes again; P2's bars stay untouched.
    hud.update(context({ game, ready: ready() }));
    expect(track.flashes).toBe(1);
    expect(elements.get('resource-1-revenge')!.classes.size).toBe(0);
    expect(elements.get('resource-0-special')!.classes.size).toBe(0);
    // Effects off: no pulse and no flash, the READY state stays readable.
    hud.update(context({ game, ready: ready(false) }));
    expect([...track.classes]).toEqual(['is-full']);
    full(game, 0, 'revenge', 40);
    hud.update(context({ game, ready: ready() }));
    expect(track.classes.size).toBe(0);
    expect(label.classes.has('is-visible')).toBe(false);
  });
  it('does not flash a bar that is already full when the HUD first sees it (round start, replay, import)', () => {
    const { elements, document } = fakeDocument(), hud = new Hud(document), game = createGame();
    full(game, 1, 'special');
    hud.update(context({ game, ready: { effects: true, events: () => 7 } }));
    const track = elements.get('resource-1-special')!;
    expect(track.classes.has('is-full')).toBe(true);
    expect(track.classes.has('is-pulsing')).toBe(true);
    expect(track.flashes).toBe(0);
  });
});
