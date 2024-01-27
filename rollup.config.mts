import res from '@rollup/plugin-node-resolve';
import cjs from '@rollup/plugin-commonjs';
import type { RollupOptions } from 'rollup'

export default {
  input: 'dist/index.js',
  output: {
    file: 'dist/bundle.js',
    format: 'cjs'
  },
  plugins: [cjs.default(), res.default()],
} satisfies RollupOptions;
