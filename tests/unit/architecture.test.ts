import { describe, expect, it } from 'vitest';
import { MOVES } from '../../src/data/schema';
import contactGeometry from '../../src/data/contact-geometry';
import { CHORD_UPGRADES, CHORD_WINDOW_FRAMES } from '../../src/simulation/combat';
import { usesPoseContact } from '../../src/simulation/pose-contact';
import { BUTTONS, buttonBit, neutralInput, type Button } from '../../src/input/types';
import { createGame, step } from '../../src/simulation/state';

const SOURCES = import.meta.glob<string>('../../src/**/*.ts', { query: '?raw', import: 'default', eager: true });

function resolvePath(from: string, specifier: string): string {
  const parts = from.split('/').slice(0, -1);
  for (const part of specifier.split('/')) {
    if (part === '..') parts.pop(); else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}
/** Runtime imports only: `import type` and `export type` disappear at build time. */
function runtimeImports(file: string): string[] {
  const found: string[] = [];
  for (const match of SOURCES[file].matchAll(/^\s*(import|export)\s+(type\s+)?[^'";]*?from\s+['"](\.[^'"]+)['"]/gm)) {
    if (match[2]) continue;
    const base = resolvePath(file, match[3]);
    const candidate = [base, `${base}.ts`, `${base}/index.ts`].find(path => path in SOURCES);
    if (candidate) found.push(candidate);
  }
  return found;
}

describe('architecture guards', () => {
  it('has no runtime import cycles in src', () => {
    const graph = new Map(Object.keys(SOURCES).map(file => [file, runtimeImports(file)]));
    expect(graph.size).toBeGreaterThan(50);
    const cycles: string[] = [];
    const state = new Map<string, 'visiting' | 'done'>();
    const visit = (file: string, path: string[]): void => {
      if (state.get(file) === 'done') return;
      if (state.get(file) === 'visiting') { cycles.push([...path.slice(path.indexOf(file)), file].join(' → ')); return; }
      state.set(file, 'visiting');
      for (const next of graph.get(file) ?? []) visit(next, [...path, file]);
      state.set(file, 'done');
    };
    for (const file of graph.keys()) visit(file, []);
    expect(cycles).toEqual([]);
  });

  it('declares chord upgrades only between existing moves and buttons', () => {
    expect(CHORD_WINDOW_FRAMES).toBe(3);
    for (const chord of CHORD_UPGRADES) {
      expect(MOVES[chord.target], chord.target).toBeDefined();
      const sources = Object.entries(chord.sources);
      expect(sources).toHaveLength(2);
      expect(new Set(sources.map(([, button]) => button)).size).toBe(2);
      for (const [id, button] of sources) {
        expect(MOVES[id], id).toBeDefined();
        expect(BUTTONS).toContain(button);
        expect(MOVES[id].button, id).toBe(button);
      }
    }
  });

  // Guard for new combos: a two-button hold move without a matching chord entry
  // only fires when both keys land in the very same frame.
  it('gives every two-button hold move a chord upgrade that works in the real engine', () => {
    const chordMoves = Object.values(MOVES).filter(move => move.command.type === 'hold' && move.command.buttons.length === 2);
    expect(chordMoves.length).toBeGreaterThan(0);
    for (const move of chordMoves) {
      const chords = CHORD_UPGRADES.filter(chord => chord.target === move.id);
      expect(chords, `${move.id}: genau ein Eintrag in CHORD_UPGRADES`).toHaveLength(1);
      const [chord] = chords;
      expect(chord.direction, move.id).toBe(move.command.directions[0]);
      expect(Object.values(chord.sources).sort(), move.id).toEqual([...move.command.buttons].sort());
    }
    const held = (facing: 1 | -1, direction: number, buttons = 0) =>
      ({ ...neutralInput(), left: direction === 4 ? facing === 1 : facing === -1, right: direction === 6 ? facing === 1 : facing === -1, buttons });
    const setup = (facing: 1 | -1) => {
      const game = createGame(), [a, b] = game.fighters;
      a.x = 450 * 256; b.x = a.x + facing * 250 * 256;
      a.facing = a.attackFacing = facing; b.facing = b.attackFacing = -facing as 1 | -1;
      return game;
    };
    for (const chord of CHORD_UPGRADES) {
      const sources = Object.entries(chord.sources) as [string, Button][];
      for (const facing of [1, -1] as const) {
        // Each source is the move the engine starts for its single button.
        for (const [id, button] of sources) {
          const game = setup(facing);
          step(game, [held(facing, chord.direction, buttonBit(button)), neutralInput()]);
          expect(game.fighters[0].moveId, `${chord.target}: ${button} allein`).toBe(id);
        }
        // Both key orders, simultaneous or up to CHORD_WINDOW_FRAMES apart, end in the chord.
        for (const [[, first], [, second]] of [sources, [...sources].reverse()]) for (let gap = 0; gap <= CHORD_WINDOW_FRAMES; gap++) {
          const game = setup(facing), both = buttonBit(first) | buttonBit(second);
          for (let i = 0; i < gap; i++) step(game, [held(facing, chord.direction, buttonBit(first)), neutralInput()]);
          step(game, [held(facing, chord.direction, both), neutralInput()]);
          expect(game.fighters[0].moveId, `${chord.target}: ${first} → ${second}, ${gap} Frames`).toBe(chord.target);
        }
      }
    }
  });

  it('classifies exactly the moves with baked strike capsules as pose-contact moves', () => {
    const geometry = contactGeometry as unknown as Record<string, { frames: { strikes: Record<string, unknown> }[] }>;
    for (const id of Object.keys(MOVES)) {
      const baked = geometry[id]?.frames.some(frame => Object.keys(frame.strikes).length > 0) ?? false;
      expect(usesPoseContact(id), id).toBe(baked);
    }
  });
});
