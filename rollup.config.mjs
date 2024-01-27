import resolve from '@rollup/plugin-node-resolve';
import cjs from '@rollup/plugin-commonjs';
import { RollupOptions } from 'rollup'

/** @satisfies RollupOptions */
export default {
  input: 'dist/index.js',
  output: {
    file: 'dist/bundle.js',
    format: 'cjs'
  },
  plugins: [cjs(), resolve()]
};