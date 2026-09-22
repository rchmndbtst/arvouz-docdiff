import { context } from 'esbuild';
import { rm } from 'node:fs/promises';

const watchMode = process.argv.includes('--watch');
const production = !watchMode;

await rm('dist', { recursive: true, force: true });

const shared = {
  bundle: true,
  logLevel: 'info',
  minify: production,
  sourcemap: watchMode,
};

const extensionContext = await context({
  ...shared,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
});

// Standalone: invoked by `git` itself as a textconv driver, with no VS Code
// process and no node_modules guaranteed on the resolution path, so mammoth
// must be bundled in rather than required at runtime.
const textconvContext = await context({
  ...shared,
  entryPoints: ['src/textconvEntry.ts'],
  outfile: 'dist/textconv.cjs',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
});

const webviewContext = await context({
  ...shared,
  entryPoints: ['webview-src/main.ts'],
  outfile: 'dist/webview/main.js',
  platform: 'browser',
  format: 'iife',
  target: 'chrome114',
  assetNames: 'assets/[name]-[hash]',
  loader: {
    '.ttf': 'file',
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development'),
  },
});

if (watchMode) {
  await Promise.all([extensionContext.watch(), textconvContext.watch(), webviewContext.watch()]);
  console.log('Watching extension, textconv and webview sources...');
} else {
  await Promise.all([
    extensionContext.rebuild(),
    textconvContext.rebuild(),
    webviewContext.rebuild(),
  ]);
  await Promise.all([
    extensionContext.dispose(),
    textconvContext.dispose(),
    webviewContext.dispose(),
  ]);
}
