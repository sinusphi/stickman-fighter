import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  test: { css: { include: [/\.css/] }, include: ['tests/{unit,integration}/**/*.test.ts'] },
});
