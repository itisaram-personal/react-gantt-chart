import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/styles.css'],
  format: ['esm', 'cjs'],
  dts: { entry: 'src/index.ts' },
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: 'es2020',
  external: [
    '@gantt-chart/core',
    '@gantt-chart/echarts',
    '@gantt-chart/themes',
    'echarts',
    'echarts/core',
    'echarts/charts',
    'echarts/renderers',
    'react',
    'react-dom',
    'react/jsx-runtime',
  ],
});
