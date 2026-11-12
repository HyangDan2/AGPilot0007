import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/AGPilot0007/' : './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'favicon.svg', 'favicon-32x32.png', 'apple-touch-icon.png', 'social-preview.png', 'luts/*.cube', 'thumbnails/*.jpg'],
      manifest: {
        name: 'Film Studio | HD2Lab',
        short_name: 'Film Studio',
        description: 'HD2Lab Film Color Simulation & Photo Development Studio',
        theme_color: '#101110',
        background_color: '#101110',
        display: 'standalone',
        orientation: 'any',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512x512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,cube,json}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
    fs: {
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.private/**'],
    },
    watch: {
      ignored: ['**/.private/**', '**/research/**'],
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    exclude: ['node_modules', 'dist', 'tests/e2e/**', '**/.private/**'],
  },
});
