import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const source = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    /**
     * Suites import workspace packages by their public name but resolve to
     * source, so a test never silently runs against a stale `dist`.
     */
    alias: {
      '@gantt-chart/core': source('gantt-core'),
      '@gantt-chart/themes': source('gantt-themes'),
      '@gantt-chart/echarts': source('gantt-echarts'),
      '@gantt-chart/react': source('gantt-react'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'packages/*/test/**/*.test.tsx'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/index.ts', '**/*.d.ts'],
    },
  },
});
