// Resolves the Python 3 interpreter for generators: $PYTHON, then python3, then python.
import { spawnSync } from 'node:child_process';

function isPython3(command) {
  const result = spawnSync(command, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)'], { stdio: 'ignore' });
  return result.status === 0;
}

export const PYTHON = [process.env.PYTHON, 'python3', 'python'].find(command => command && isPython3(command));
if (!PYTHON) throw Error('Python >= 3.8 not found. Install Python 3 or set PYTHON to its executable.');
