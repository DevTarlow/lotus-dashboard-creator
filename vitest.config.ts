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
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      setupFiles: ['./src/test/setup.ts'],
      restoreMocks: true,
      reporters: 'default',
    },
  }),
);
