// This file is used only by the Vite step inside build.mjs
// (background.js + offscreen.js as ES modules).
// The content-script entries (content.js, injected.js) are handled
// separately by esbuild in build.mjs → self-contained IIFEs.
import { defineConfig } from 'vite';

export default defineConfig({});
