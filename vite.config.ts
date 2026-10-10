import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    cssCodeSplit: true,
    reportCompressedSize: false,
  },
});
