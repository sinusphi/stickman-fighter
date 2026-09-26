import data from '../data/ai-profiles.json';
export type Difficulty = keyof typeof data;
export interface CpuProfile {
  label: string; reactionFrames: number; decisionFrames: number;
  attackPauseFrames: number;
  blockChance: number; correctBlockChance: number; punishChance: number;
  antiAirChance: number; executionError: number; aggression: number;
  holdChance: number; comboChance: number; adaptation: number;
}
export function validateProfiles(value: unknown): Record<Difficulty, CpuProfile> {
  const profiles = value as Record<Difficulty, CpuProfile>;
  for (const level of ['easy', 'medium', 'hard'] as const) {
    const p = profiles?.[level];
    if (!p || typeof p.label !== 'string' || !p.label.trim() ||
      !Number.isSafeInteger(p.reactionFrames) || p.reactionFrames < 8 || p.reactionFrames > 120 ||
      !Number.isSafeInteger(p.decisionFrames) || p.decisionFrames < 1 || p.decisionFrames > 60 ||
      !Number.isSafeInteger(p.attackPauseFrames) || p.attackPauseFrames < 0 || p.attackPauseFrames > 180 ||
      !(['blockChance', 'correctBlockChance', 'punishChance', 'antiAirChance', 'executionError', 'aggression', 'holdChance', 'comboChance', 'adaptation'] as const)
        .every(key => Number.isFinite(p[key]) && p[key] >= 0 && p[key] <= 1) ||
      p.blockChance >= 1 || p.executionError <= 0) throw Error(`Ungültiges CPU-Profil: ${level}`);
  }
  return profiles;
}
export const PROFILES = validateProfiles(data);
export interface CpuSettings { enabled: boolean; demo: boolean; difficulty: Difficulty; playerOneDifficulty: Difficulty }
export const SETTINGS_KEY = 'stickman-cpu-v1';
export function loadCpuSettings(storage: Pick<Storage, 'getItem'>): CpuSettings {
  try {
    const value = JSON.parse(storage.getItem(SETTINGS_KEY) ?? 'null');
    if (typeof value?.enabled === 'boolean' && Object.hasOwn(PROFILES, value.difficulty)) return {
      enabled:value.enabled,
      demo:typeof value.demo === 'boolean' ? value.demo : false,
      difficulty:value.difficulty,
      playerOneDifficulty:Object.hasOwn(PROFILES,value.playerOneDifficulty) ? value.playerOneDifficulty : 'medium',
    };
  } catch { /* Disabled or corrupt storage must not prevent playing. */ }
  return { enabled:false, demo:false, difficulty:'medium', playerOneDifficulty:'medium' };
}
export function saveCpuSettings(storage: Pick<Storage, 'setItem'>, value: CpuSettings): void {
  try { storage.setItem(SETTINGS_KEY, JSON.stringify(value)); } catch { /* Private browsing / quota. */ }
}
