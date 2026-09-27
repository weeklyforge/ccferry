/// <reference types="vitest/config" />
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// The PWA service worker is compiled separately (esbuild in the build
// script) and kept MINIMAL — push events only, no caching layer. A
// workbox-based precache SW froze lazily-loaded tabs after every deploy
// (stale chunk hashes) and bought nothing: the app is an online tool.
export default defineConfig({
  plugins: [vue()],
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  test: { environment: 'node' },
});
