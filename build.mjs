// build.mjs — custom build script for the WhatsApp Web Transcriber extension
//
// Chrome MV3 content scripts cannot use ES-module `import` statements.
// This script:
//   1. Uses esbuild to bundle content.js + injected.js as self-contained IIFEs.
//   2. Uses Vite (Rollup) to bundle background.js + offscreen.js as ES modules.
//   3. Copies the WASM ORT backend files into dist/wasm/.

import { build } from 'vite';
import { buildSync } from 'esbuild';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, cpSync, rmSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'dist');

// ── 1. Clean dist ──────────────────────────────────────────────────────────
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
console.log('[build] dist/ cleaned');

// ── 2. Bundle content + injected as self-contained IIFEs via esbuild ───────
//    esbuild resolves TypeScript imports and tree-shakes without needing
//    @rollup/plugin-typescript; it bundles everything into one file per entry.
const iifeBundles = [
  { in: 'src/injected/interceptor.ts', out: 'dist/injected.js' },
  { in: 'src/content/index.ts',        out: 'dist/content.js'  },
];

for (const { in: entry, out: outFile } of iifeBundles) {
  buildSync({
    entryPoints: [resolve(__dirname, entry)],
    outfile: resolve(__dirname, outFile),
    bundle: true,
    format: 'iife',
    target: 'es2022',
    // .wasm files are runtime-loaded via chrome.runtime.getURL; exclude them.
    external: ['*.wasm'],
    platform: 'browser',
    sourcemap: false,
  });
  console.log(`[esbuild] ${outFile} written (IIFE, self-contained)`);
}

// ── 3. Bundle background + offscreen as ES modules via Vite ───────────────
await build({
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: false,        // keep injected.js + content.js from step 2
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/service-worker.ts'),
        offscreen:  resolve(__dirname, 'src/offscreen/whisper.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        format: 'es',
      },
      external: (id) => id.endsWith('.wasm'),
    },
  },
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.{mjs,wasm,jsep.mjs,jsep.wasm}',
          dest: 'wasm',
        },
      ],
    }),
  ],
});

console.log('[build] ✓ all done');
