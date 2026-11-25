import { describe, expect, it } from 'vitest';
import rules from '../../src/data/rules.json';
import { BOT_PROFILES, minutesCsv, percentile, runSurvival, runsCsv, summaryMarkdown, type BotProfileId } from '../../scripts/survival-balance-lib';

const maxFrames = 75 * rules.hz;

describe('survival balance run', () => {
  for (const profile of Object.keys(BOT_PROFILES) as BotProfileId[]) {
    it(`gives the same run for the same seed (${profile})`, () => {
      const a = runSurvival({ seed: 7, profile, maxFrames });
      const b = runSurvival({ seed: 7, profile, maxFrames });
      expect(b).toEqual(a);
      expect(a.survivedFrames).toBeGreaterThan(0);
      expect(a.survivedFrames).toBeLessThanOrEqual(maxFrames);
    });
  }

  it('keeps its bookkeeping consistent', () => {
    const r = runSurvival({ seed: 3, profile: 'aggressive', maxFrames });
    expect(r.minutes.reduce((sum, m) => sum + m.gained, 0)).toBe(r.energyGained);
    expect(r.minutes.reduce((sum, m) => sum + m.lost, 0)).toBe(r.energyLost);
    // Energy at the end = start + gained - lost.
    expect(r.minutes.at(-1)?.hpEnd).toBe(1000 + r.energyGained - r.energyLost);
    expect(r.timeout).toBe(r.death === null);
    expect(r.kills.boss).toBe(r.bossesKilled);
  });

  it('differs between seeds and writes reports', () => {
    const results = [1, 2].map(seed => runSurvival({ seed, profile: 'defensive', maxFrames }));
    expect(results[0]).not.toEqual(results[1]);
    expect(runsCsv(results, ['rookie']).split('\n')[0]).toContain('kills_rookie');
    expect(minutesCsv(results).split('\n').length).toBeGreaterThan(2);
    expect(summaryMarkdown('defensive', results, { seedStart: 1, maxFrames })).toContain('Median');
  });

  it('interpolates percentiles', () => {
    expect(percentile([10, 20, 30, 40, 50], 0.5)).toBe(30);
    expect(percentile([0, 100], 0.1)).toBe(10);
    expect(percentile([], 0.5)).toBe(0);
  });
});
