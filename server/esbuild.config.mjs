import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [resolve(here, 'src/index.ts')],
  outfile: resolve(here, 'dist/index.js'),
  platform: 'node',
  target: 'node20',
  format: 'esm',
  bundle: true,
  sourcemap: true,
  external: ['pino-pretty'],
  banner: { js: "import { createRequire } from 'module';const require = createRequire(import.meta.url);" },
  alias: {
    '@engine': resolve(here, '../src/lib/game'),
  },
});
