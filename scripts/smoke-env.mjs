// Shared settings for all browser smoke scripts.
//   TEST_URL     app under test (default: the `npm run dev` address)
//   CHROME_PATH  Chrome/Chromium executable; otherwise Playwright's own Chromium
//   TEST_BROWSER chromium (default) or firefox, for scripts that support both
import { existsSync } from 'node:fs';

export const TEST_URL = process.env.TEST_URL || 'http://127.0.0.1:5173';

const SYSTEM_CHROME = ['/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
export function chromeExecutable() {
  return process.env.CHROME_PATH || SYSTEM_CHROME.find(path => existsSync(path));
}
