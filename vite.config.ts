import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  /**
   * `--mode single` produces the portable dashboard: one HTML file with the
   * script, the styles and every image inlined, written to `dist-single/`.
   * `scripts/build-single-file.mjs` finishes the job (Vite does not inline the
   * entry chunk or the stylesheet by itself).
   */
  const single = mode === 'single';

  return {
    plugins: [react(), tailwindcss()],
    // Every path inside a single-file build is inlined anyway; a relative base
    // keeps anything that slips through resolvable from the file's own folder.
    base: single ? './' : '/',
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      // Pinned: `localStorage` is partitioned per origin, so silently hopping to
      // 5174 when 5173 is busy would show an empty dashboard and look like data
      // loss. Fail loudly instead.
      strictPort: true,
      open: false,
    },
    preview: {
      port: 4173,
    },
    build: {
      target: 'es2022',
      cssCodeSplit: !single,
      reportCompressedSize: false,
      outDir: single ? 'dist-single' : 'dist',
      // Inline images as data URIs in the single-file build; keep them as files
      // for the normal build so it stays cacheable.
      assetsInlineLimit: single ? Number.MAX_SAFE_INTEGER : 4096,
    },
  };
});
