import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  base: './',
  // App version for the footer; package.json stays the single source.
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'moves-data', test: /[\\/]src[\\/]data[\\/]moves\.json$/ },
            { name: 'poses-data', test: /[\\/]src[\\/]data[\\/]poses\.json$/ },
            { name: 'contact-data-0', test: /[\\/]src[\\/]data[\\/]contact-geometry-0\.json$/ },
            { name: 'contact-data-1', test: /[\\/]src[\\/]data[\\/]contact-geometry-1\.json$/ },
            { name: 'contact-data-2', test: /[\\/]src[\\/]data[\\/]contact-geometry-2\.json$/ },
          ],
        },
      },
    },
  },
  test: {
    css: { include: [/\.css/] },
    include: ['tests/{unit,integration}/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['src/**/*.ts'], reporter: ['text-summary', 'html'], reportsDirectory: 'test-results/coverage' },
  },
});
