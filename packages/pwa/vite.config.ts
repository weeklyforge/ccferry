/// <reference types="vitest/config" />
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      manifest: {
        name: 'ccferry',
        short_name: 'ccferry',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#1989fa',
        icons: [],
      },
    }),
  ],
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  test: { environment: 'node' },
});
