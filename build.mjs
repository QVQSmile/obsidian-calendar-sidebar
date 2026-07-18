import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'es2020',
  external: ['obsidian'],
  outfile: 'main.js',
  sourcemap: false,
  legalComments: 'none',
});
