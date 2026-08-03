import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const source = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    /**
     * The demo runs against package *source*, so editing the engine or the
     * adapter hot-reloads here without a build step. Order matters: the
     * stylesheet entry has to win over the bare package name.
     */
    alias: [
      { find: '@gantt-chart/react/styles.css', replacement: source('../gantt-react/src/styles.css') },
      { find: '@gantt-chart/react', replacement: source('../gantt-react/src/index.ts') },
      { find: '@gantt-chart/echarts', replacement: source('../gantt-echarts/src/index.ts') },
      { find: '@gantt-chart/themes', replacement: source('../gantt-themes/src/index.ts') },
      { find: '@gantt-chart/core', replacement: source('../gantt-core/src/index.ts') },
    ],
  },
  server: { port: 5174, open: false },
  build: { target: 'es2020', sourcemap: true },
});
