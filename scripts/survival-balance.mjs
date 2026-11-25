/**
 * Headless survival balance run: a player bot plays many complete survival
 * runs on the deterministic simulation, without a browser.
 *
 *   npm run balance:survival -- [--runs 100] [--seed 1] [--profile all|defensive|aggressive] [--max-seconds 600]
 *
 * Output (test-results/survival-balance/):
 *   summary.md   median / 10th / 90th percentile of the survived time, kills per
 *                type, boss reached, causes of death, energy balance per minute
 *   runs.csv     one line per run (kills, boss, death cause, energy, hp per minute)
 *   minutes.csv  one line per run and minute (energy at the end, gained, lost, net)
 *
 * The bot is NOT a human. It reuses the versus CPU brain against one target
 * enemy at a time, turns by double tap and reacts to back warnings, but plays
 * nothing like a person. Absolute times are meaningless; use the numbers for
 * before/after comparisons of tuning changes in src/survival/config.ts – same
 * seeds, same profile, same time limit. Every run is deterministic: the same
 * seed always gives the same run.
 *
 * TypeScript from src/ is loaded through Vite's SSR loader (as in cpu:tournament).
 */
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    runs: { type: 'string', default: '100' },
    seed: { type: 'string', default: '1' },
    profile: { type: 'string', default: 'all' },
    'max-seconds': { type: 'string', default: '600' },
    out: { type: 'string', default: 'test-results/survival-balance' },
    help: { type: 'boolean', default: false },
  },
});
if (values.help) {
  console.log('npm run balance:survival -- [--runs N] [--seed S] [--profile all|defensive|aggressive] [--max-seconds T] [--out DIR]');
  process.exit(0);
}
const runs = Number(values.runs), seedStart = Number(values.seed), maxSeconds = Number(values['max-seconds']);
if (!Number.isSafeInteger(runs) || runs < 1) throw Error('--runs must be an integer >= 1.');
if (!Number.isSafeInteger(seedStart)) throw Error('--seed must be an integer.');
if (!(maxSeconds > 0)) throw Error('--max-seconds must be > 0.');

const server = await createServer({ server: { middlewareMode: true, ws: false, hmr: false, watch: null }, appType: 'custom', logLevel: 'warn' });
try {
  const lib = await server.ssrLoadModule('/scripts/survival-balance-lib.ts');
  const { SURVIVAL } = await server.ssrLoadModule('/src/survival/config.ts');
  const { hz } = (await server.ssrLoadModule('/src/data/rules.json')).default;
  const all = Object.keys(lib.BOT_PROFILES);
  const profiles = values.profile === 'all' ? all : [values.profile];
  for (const p of profiles) if (!all.includes(p)) throw Error(`Unknown profile "${p}" (${all.join(', ')}).`);
  const maxFrames = Math.round(maxSeconds * hz), types = Object.keys(SURVIVAL.types);

  const results = [], sections = [];
  for (const profile of profiles) {
    const own = [], started = performance.now();
    for (let i = 0; i < runs; i++) {
      const r = lib.runSurvival({ seed: seedStart + i, profile, maxFrames });
      own.push(r);
      process.stdout.write(`\r${profile}: ${i + 1}/${runs} (seed ${r.seed}: ${(r.survivedFrames / hz).toFixed(1)} s, ${lib.deathLabel(r.death)})        `);
    }
    process.stdout.write(`\n${profile}: ${((performance.now() - started) / 1000).toFixed(1)} s wall time\n`);
    results.push(...own);
    sections.push(lib.summaryMarkdown(profile, own, { seedStart, maxFrames }));
  }

  const header = [
    '# Survival balance', '',
    `Generated ${new Date().toISOString()} · runs per profile ${runs} · seeds from ${seedStart} · limit ${maxSeconds} s`, '',
    '> The player bot is not a human. These numbers are only meaningful for before/after',
    '> comparisons of tuning changes in `src/survival/config.ts` (same seeds, profile and limit),',
    '> not as absolute survival times.', '',
  ];
  await mkdir(values.out, { recursive: true });
  await writeFile(`${values.out}/summary.md`, [...header, ...sections].join('\n'));
  await writeFile(`${values.out}/runs.csv`, lib.runsCsv(results, types));
  await writeFile(`${values.out}/minutes.csv`, lib.minutesCsv(results));
  console.log(`Written: ${values.out}/summary.md, runs.csv, minutes.csv`);
} finally { await server.close(); }
