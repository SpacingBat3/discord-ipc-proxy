import res from '@rollup/plugin-node-resolve';
import cjs from '@rollup/plugin-commonjs';
import type { RollupOptions } from 'rollup'

export default {
  input: 'dist/main.js',
  output: {
    file: 'dist/bundle.js',
    format: 'cjs',
    compact: true
  },
  plugins: [
    (cjs as unknown as typeof cjs.default)(),
    (res as unknown as typeof res.default)()
  ],
} satisfies RollupOptions;
