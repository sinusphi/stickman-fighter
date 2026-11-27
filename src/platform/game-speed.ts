/**
 * Game speed. Presentation-side only: the speed scales how fast the
 * fixed-step loop consumes wall-clock time, so the simulation runs more 60 Hz
 * frames per real second while every frame stays identical (replays and the
 * data hash are unaffected).
 *
 * The switch in the arena bar turns the boost on; the slider picks one of
 * three levels. Tune the levels here: each value is the speed-up over the
 * standard pace in percent (20 = 20 % faster, i.e. a time scale of 1.2).
 * The percentages are never shown in the UI.
 */
export const SPEED_LEVELS = [20, 32, 40] as const;

export type SpeedLevel = 1 | 2 | 3;
export interface GameSpeed { enabled: boolean; level: SpeedLevel }

export const DEFAULT_GAME_SPEED: Readonly<GameSpeed> = { enabled: false, level: 1 };
export const SPEED_STORAGE_KEY = 'stickman.speed';

export function isSpeedLevel(value: unknown): value is SpeedLevel {
  return value === 1 || value === 2 || value === 3;
}

/** Level that currently drives the loop: 0 = standard pace. */
export function activeSpeedLevel(speed: GameSpeed): 0 | SpeedLevel {
  return speed.enabled ? speed.level : 0;
}

/** Wall-clock multiplier for the fixed-step loop. */
export function gameSpeedScale(speed: GameSpeed): number {
  const level = activeSpeedLevel(speed);
  return level ? 1 + SPEED_LEVELS[level - 1] / 100 : 1;
}

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'setItem'>;
const browserStorage = (): Storage | undefined => typeof window === 'undefined' ? undefined : window.localStorage;

export function loadGameSpeed(storage?: Reader): GameSpeed {
  try {
    const value: unknown = JSON.parse((storage ?? browserStorage())?.getItem(SPEED_STORAGE_KEY) ?? 'null');
    if (value && typeof value === 'object') {
      const { enabled, level } = value as Record<string, unknown>;
      if (typeof enabled === 'boolean' && isSpeedLevel(level)) return { enabled, level };
    }
  } catch { /* Invalid or blocked storage: standard pace. */ }
  return { ...DEFAULT_GAME_SPEED };
}

/** Returns false when the browser refuses storage; the session keeps the choice anyway. */
export function saveGameSpeed(speed: GameSpeed, storage?: Writer): boolean {
  try {
    const target = storage ?? browserStorage();
    if (!target) return false;
    target.setItem(SPEED_STORAGE_KEY, JSON.stringify({ enabled: speed.enabled, level: speed.level }));
    return true;
  } catch { return false; }
}
