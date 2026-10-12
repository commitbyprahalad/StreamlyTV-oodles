import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';

// Samsung TVs run an old Chromium (Tizen 3.0 = Chrome 47), which has no ES
// modules and no ES2015+ syntax. plugin-legacy compiles everything to ES5,
// adds the core-js polyfills the bundle actually uses, and loads it through
// SystemJS with plain <script> tags — this also works from file:// inside a
// packaged .wgt. Modern (module) chunks are not emitted at all, so every TV
// runs the same code path.
// A packaged .wgt is loaded from file://, where a `crossorigin` script is a
// CORS request that the engine refuses — so drop the attribute.
function stripCrossorigin() {
  return {
    name: 'strip-crossorigin',
    enforce: 'post',
    transformIndexHtml: function (html) {
      return html.replace(/\s+crossorigin(="[^"]*")?/g, '');
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [
    react(),
    legacy({
      targets: ['chrome >= 47'],
      renderModernChunks: false,
      polyfills: true,
    }),
    stripCrossorigin(),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssTarget: 'chrome47',
    assetsInlineLimit: 4096,
    modulePreload: false,
    sourcemap: false,
    minify: 'terser',
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
  },
});
