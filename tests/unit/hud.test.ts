import { describe, expect, it } from 'vitest';
import { createGame } from '../../src/simulation/state';
import { Hud, hudLabels, hudModes, type HudContext } from '../../src/platform/hud';

const idle = { kind: 'wait', score: 0, reason: 'observe' } as const;
function context(overrides: Partial<HudContext> = {}): HudContext {
  return {
    game: createGame(), paused: false, muted: false,
    cpu: { enabled: false, demo: false, difficulty: 'medium', playerOneDifficulty: 'medium' } as HudContext['cpu'],
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
    expect(hudModes(context())).toEqual({ trainingCpu: false, cpuActive: false, demoActive: false, cpuPresent: false });
    const vsCpu = context({ cpu: { enabled: true, demo: false, difficulty: 'medium', playerOneDifficulty: 'medium' } as HudContext['cpu'] });
    expect(hudModes(vsCpu).cpuActive).toBe(true);
    expect(hudLabels(vsCpu).p2).toBe('CPU');
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
});
