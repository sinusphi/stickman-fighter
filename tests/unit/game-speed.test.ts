import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_SPEED, SPEED_LEVELS, SPEED_STORAGE_KEY, activeSpeedLevel, gameSpeedPercent, gameSpeedScale, versusLoopSpeed, loadGameSpeed, saveGameSpeed, type SpeedLevel } from '../../src/platform/game-speed';
import { FixedLoop } from '../../src/platform/loop';
import { hudLabels, type HudContext } from '../../src/platform/hud';
import { createGame, snapshot, step } from '../../src/simulation/state';
import { createReplay, parseReplay, validateSnapshot } from '../../src/debug/replay';
import { neutralInput } from '../../src/input/types';
import rules from '../../src/data/rules.json';

const memory = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } }; };
const levels: SpeedLevel[] = [1, 2, 3];

describe('game speed', () => {
  it('runs at standard pace while switched off and 20 / 32 / 40 % faster on levels 1–3', () => {
    expect(SPEED_LEVELS).toEqual([20, 32, 40]);
    for (const level of levels) expect(gameSpeedScale({ enabled: false, level })).toBe(1);
    expect(levels.map(level => gameSpeedScale({ enabled: true, level }))).toEqual([1.2, 1.32, 1.4]);
    expect(activeSpeedLevel({ enabled: false, level: 3 })).toBe(0);
    expect(activeSpeedLevel({ enabled: true, level: 2 })).toBe(2);
  });

  it('stores switch and level, falling back to standard for invalid or blocked storage', () => {
    const storage = memory();
    expect(loadGameSpeed(storage)).toEqual(DEFAULT_GAME_SPEED);
    expect(saveGameSpeed({ enabled: true, level: 3 }, storage)).toBe(true);
    expect(loadGameSpeed(storage)).toEqual({ enabled: true, level: 3 });
    // Off keeps the chosen level for the next time the switch is turned on.
    saveGameSpeed({ enabled: false, level: 2 }, storage);
    expect(loadGameSpeed(storage)).toEqual({ enabled: false, level: 2 });
    for (const bad of ['turbo', '{"enabled":true,"level":4}', '{"enabled":"yes","level":1}', '{']) {
      storage.setItem(SPEED_STORAGE_KEY, bad);
      expect(loadGameSpeed(storage)).toEqual(DEFAULT_GAME_SPEED);
    }
    expect(loadGameSpeed({ getItem: () => { throw new Error('blocked'); } })).toEqual(DEFAULT_GAME_SPEED);
  });

  it('runs proportionally more fixed frames per wall-clock second', () => {
    const framesIn = (speed: number) => {
      const loop = new FixedLoop(); loop.speed = speed;
      let frames = 0; let time = 0;
      loop.advance(time, () => frames++);
      for (let i = 0; i < 600; i++) { time += loop.frameMs; loop.advance(time, () => frames++); }
      return frames;
    };
    expect(framesIn(1)).toBe(600);
    for (const level of levels) {
      const scale = gameSpeedScale({ enabled: true, level });
      expect(Math.abs(framesIn(scale) - 600 * scale)).toBeLessThanOrEqual(1);
    }
  });

  it('shows the active level under the round label without any percentage', () => {
    const context = (speedLevel?: number): HudContext => ({
      game: createGame(), paused: false, muted: false,
      cpu: { enabled: false, demo: false, difficulty: 'medium', playerOneDifficulty: 'medium', humanSide: 0 },
      cpuDebug: [{ kind: 'wait', score: 0, reason: 'observe' }, { kind: 'wait', score: 0, reason: 'observe' }],
      playback: null, recordingFrames: null, replayFrames: 0, show: { boxes: false, inputs: false, states: false }, stageCaption: 'DOJO', speedLevel,
    });
    expect(hudLabels(context()).speed).toBe('');
    expect(hudLabels(context(0)).speed).toBe('');
    for (const level of levels) {
      const label = hudLabels(context(level)).speed;
      expect(label).toContain(String(level));
      expect(label).not.toContain('%');
    }
  });

  it('keeps the round timer on real seconds at every level', () => {
    for (const level of [0, ...levels] as const) {
      const percent = level ? gameSpeedPercent({ enabled: true, level }) : 100;
      const game = createGame();
      step(game, [neutralInput(), neutralInput()], [{ type: 'pace', percent }]);
      const start = game.round.timer;
      // One real second runs `percent` / 100 seconds' worth of frames.
      for (let i = 1; i < rules.hz * percent / 100 * 10; i++) step(game);
      expect(start - game.round.timer).toBeGreaterThanOrEqual(rules.hz * 10 - 2);
      expect(start - game.round.timer).toBeLessThanOrEqual(rules.hz * 10 + 1);
    }
  });

  it('keeps the pace through a reset and drops it at the standard pace', () => {
    const game = createGame({ intro: true });
    step(game, undefined, [{ type: 'pace', percent: 140 }]);
    step(game, undefined, [{ type: 'reset' }]);
    expect(game.pace).toBe(140);
    expect(game.round.phase).toBe('intro');
    step(game, undefined, [{ type: 'pace', percent: 100 }]);
    expect(game.pace).toBeUndefined();
  });

  it('records the pace in replays and rejects invalid values', () => {
    const game = createGame();
    step(game, undefined, [{ type: 'pace', percent: 132 }]);
    for (let i = 0; i < 7; i++) step(game);
    expect(validateSnapshot(snapshot(game)).pace).toBe(132);
    const replay = createReplay(game);
    replay.frames.push({ inputs: [neutralInput(), neutralInput()], events: [{ type: 'pace', percent: 120 }] });
    expect(() => parseReplay(replay)).not.toThrow();
    for (const percent of [99, 201, 1.5]) {
      const bad = createReplay(game);
      bad.frames.push({ inputs: [neutralInput(), neutralInput()], events: [{ type: 'pace', percent }] });
      expect(() => parseReplay(bad)).toThrow();
    }
    expect(() => validateSnapshot({ ...snapshot(game), pace: 100 })).toThrow();
    expect(() => validateSnapshot({ ...snapshot(game), round: { ...game.round, timerCarry: 132 } })).toThrow();
  });

  it('keeps the standard pace for the round intro and the KO slow motion', () => {
    const game = createGame({ intro: true });
    step(game, undefined, [{ type: 'pace', percent: 140 }]);
    expect(game.round.phase).toBe('intro');
    expect(versusLoopSpeed(game, false)).toBe(1);
    game.round.phase = 'fighting'; game.round.intro = null;
    expect(versusLoopSpeed(game, false)).toBe(1.4);
    expect(versusLoopSpeed(game, true)).toBe(1);
    expect(versusLoopSpeed(createGame(), false)).toBe(1);
  });
});
