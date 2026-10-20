import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const root = import.meta.dirname;

// `npm run dev` serves the harness in dev/; `npm run build` emits a single
// self-contained ES module (all deps bundled) for Home Assistant.
export default defineConfig(({ command }) => ({
  root: command === 'serve' ? resolve(root, 'dev') : root,
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    target: 'es2021',
    sourcemap: false,
    lib: {
      entry: resolve(root, 'src/column-calendar-card.ts'),
      formats: ['es'],
      fileName: () => 'column-calendar-card.js',
    },
  },
}));
