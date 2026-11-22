/**
 * Presentation preferences for hit effects. Stored like stickman.language:
 * plain strings in localStorage, every access guarded because merely touching
 * window.localStorage throws when the browser blocks storage.
 */
export const EFFECTS_STORAGE_KEY = 'stickman.effects';
export const SHAKE_STORAGE_KEY = 'stickman.shake';

export interface EffectSettings {
  /** Sparks, dust, speed lines, KO flash and the combo counter. */
  effects: boolean;
  /** Screen shake and the KO zoom (camera motion). */
  shake: boolean;
}

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'setItem'>;
const browserStorage = (): Storage | undefined => typeof window === 'undefined' ? undefined : window.localStorage;

export function prefersReducedMotion(): boolean {
  try { return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true; }
  catch { return false; }
}

/** Stored choices win; without one, reduced motion turns camera motion off by default. */
export function loadEffectSettings(storage?: Reader, reducedMotion = prefersReducedMotion()): EffectSettings {
  const read = (key: string): boolean | undefined => {
    try {
      const value = (storage ?? browserStorage())?.getItem(key);
      return value === 'on' ? true : value === 'off' ? false : undefined;
    } catch { return undefined; }
  };
  return { effects: read(EFFECTS_STORAGE_KEY) ?? true, shake: read(SHAKE_STORAGE_KEY) ?? !reducedMotion };
}

/** Returns false when the browser refuses storage; the session keeps the choice anyway. */
export function saveEffectSettings(settings: EffectSettings, storage?: Writer): boolean {
  try {
    const target = storage ?? browserStorage();
    if (!target) return false;
    target.setItem(EFFECTS_STORAGE_KEY, settings.effects ? 'on' : 'off');
    target.setItem(SHAKE_STORAGE_KEY, settings.shake ? 'on' : 'off');
    return true;
  } catch { return false; }
}
