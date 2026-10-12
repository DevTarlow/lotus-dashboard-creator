import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

// `vite.config.ts` is a function (it branches on `mode` for the single-file
// build), so resolve it before merging.
const resolved = typeof viteConfig === 'function' ? viteConfig({ command: 'serve', mode: 'test' }) : viteConfig;

export default mergeConfig(
  resolved,
  defineConfig({
    test: {
      environment: 'node',
      // `scripts/` is in here for `release.mjs`: the release scripts are plain
      // `.mjs` run straight by node, so they cannot import the TypeScript helpers
      // under `src/`, and their pure decisions are worth the same tests.
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.mjs'],
      setupFiles: ['./src/test/setup.ts'],
      restoreMocks: true,
      reporters: 'default',
    },
  }),
);
