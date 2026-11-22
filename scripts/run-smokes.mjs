// Starts a Vite dev server on a free port and runs browser smoke scripts against it.
//   node scripts/run-smokes.mjs            -> core set
//   node scripts/run-smokes.mjs all        -> every scripts/*smoke.mjs
//   node scripts/run-smokes.mjs audio cpu  -> scripts/audio-smoke.mjs, scripts/cpu-smoke.mjs
// Screenshots and downloads land in test-results/ (git-ignored).
import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'vite';

const CORE = ['smoke', 'audio', 'update', 'cpu', 'stage', 'animation-preview', 'contact-timing', 'throws'];
const available = readdirSync(new URL('.', import.meta.url)).filter(name => name.endsWith('smoke.mjs')).map(name => name === 'smoke.mjs' ? 'smoke' : name.replace(/-smoke\.mjs$/, '')).sort();
const requested = process.argv.slice(2);
const names = requested.length === 0 ? CORE : requested.includes('all') ? available : requested;
const unknown = names.filter(name => !available.includes(name));
if (unknown.length) { console.error(`Unknown smoke(s): ${unknown.join(', ')}\nAvailable: ${available.join(', ')}`); process.exit(2); }

const server = await createServer({ server: { host: '127.0.0.1', port: 5190, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0].replace(/\/$/, '');
const failed = [];
try {
  for (const name of names) {
    const file = new URL(name === 'smoke' ? 'smoke.mjs' : `${name}-smoke.mjs`, import.meta.url);
    const started = Date.now();
    const code = await new Promise(resolve => spawn(process.execPath, [file.pathname], { stdio: 'inherit', env: { ...process.env, TEST_URL: url } }).on('exit', resolve));
    console.log(`${code === 0 ? 'ok  ' : 'FAIL'} ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
    if (code !== 0) failed.push(name);
  }
} finally { await server.close(); }
if (failed.length) { console.error(`Failed smokes: ${failed.join(', ')}`); process.exit(1); }
