// Shared settings for all browser smoke scripts.
//   TEST_URL     server under test (default: the `npm run dev` address)
//   CHROME_PATH  Chrome/Chromium executable; otherwise Playwright's own Chromium
//   TEST_BROWSER chromium (default) or firefox, for scripts that support both
import { existsSync } from 'node:fs';

/** Server root without query. */
export const SERVER_URL = (process.env.TEST_URL || 'http://127.0.0.1:5173').replace(/\/$/, '');
/**
 * App under test for feature smokes: `?intro=off` skips the versus round intro
 * so scripts can act right after loading. The intro has its own smoke.
 */
export const TEST_URL = `${SERVER_URL}/?intro=off`;

const SYSTEM_CHROME = ['/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
export function chromeExecutable() {
  return process.env.CHROME_PATH || SYSTEM_CHROME.find(path => existsSync(path));
}
