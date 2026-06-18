import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const commonOptions = {
  bundle: true,
  minify: !isWatch,
  sourcemap: false,
  target: ['chrome110'],
  format: 'iife',
  logLevel: 'info',
};

// Content scripts — one per site, IIFE-wrapped
const contentScriptEntries = [
  { input: 'src/content/chatgpt.ts', output: 'dist/content/chatgpt.js' },
  { input: 'src/content/claude.ts', output: 'dist/content/claude.js' },
  { input: 'src/content/gemini.ts', output: 'dist/content/gemini.js' },
];

// Service worker — ESM format for Manifest V3
const serviceWorkerConfig = {
  ...commonOptions,
  entryPoints: ['src/background/service-worker.ts'],
  outfile: 'dist/background/service-worker.js',
  format: 'esm',
};

// Popup JS — IIFE
const popupConfig = {
  ...commonOptions,
  entryPoints: ['src/popup/popup.js'],
  outfile: 'dist/popup/popup.js',
  format: 'iife',
};

// Analytics JS — IIFE, bundles Chart.js locally
const analyticsConfig = {
  ...commonOptions,
  entryPoints: ['src/analytics/analytics.js'],
  outfile: 'dist/analytics/analytics.js',
  format: 'iife',
};

async function build() {
  try {
    // Build content scripts
    for (const entry of contentScriptEntries) {
      if (isWatch) {
        const ctx = await esbuild.context({
          ...commonOptions,
          entryPoints: [entry.input],
          outfile: entry.output,
        });
        await ctx.watch();
      } else {
        await esbuild.build({
          ...commonOptions,
          entryPoints: [entry.input],
          outfile: entry.output,
        });
      }
    }

    // Build service worker
    if (isWatch) {
      const swCtx = await esbuild.context(serviceWorkerConfig);
      await swCtx.watch();
    } else {
      await esbuild.build(serviceWorkerConfig);
    }

    // Build popup
    if (isWatch) {
      const popupCtx = await esbuild.context(popupConfig);
      await popupCtx.watch();
    } else {
      await esbuild.build(popupConfig);
    }

    // Build analytics
    if (isWatch) {
      const analyticsCtx = await esbuild.context(analyticsConfig);
      await analyticsCtx.watch();
    } else {
      await esbuild.build(analyticsConfig);
    }

    if (!isWatch) {
      console.log('✅ Build complete!');
    } else {
      console.log('👀 Watching for changes...');
    }
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

build();
