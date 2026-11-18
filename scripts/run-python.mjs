// Runs a Python generator with the resolved interpreter: node scripts/run-python.mjs <script.py> [args...]
import { spawnSync } from 'node:child_process';
import { PYTHON } from './python.mjs';

const result = spawnSync(PYTHON, process.argv.slice(2), { stdio: 'inherit' });
process.exit(result.status ?? 1);
