import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isBeta = mode === 'beta' || process.env.GITHUB_REF_NAME === 'beta';
  const base = isBeta ? '/AGPilot0007/beta/' : process.env.GITHUB_ACTIONS ? '/AGPilot0007/' : './';
  return {
    base,
    build: { outDir: isBeta ? 'dist-beta' : 'dist' },
    plugins: [
      { name: 'third-party-notices', generateBundle() { this.emitFile({type:'asset', fileName:'THIRD_PARTY_NOTICES.txt', source:readFileSync('THIRD_PARTY_NOTICES.md','utf8')}); } },
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        scope: base,
        // globPatterns already covers luts/icons/txt; listing them again here
        // duplicated every LUT and icon in the precache manifest.
        includeAssets: ['thumbnails/*.jpg'],
        manifest: {
          name: isBeta ? 'Film Studio Beta | HD2Lab' : 'Film Studio | HD2Lab',
          id: base,
          start_url: base,
          scope: base,
          short_name: 'Film Studio',
          description: 'HD2Lab Film Color Simulation & Photo Development Studio',
          theme_color: '#0B1020',
          background_color: '#0B1020',
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
          globPatterns: ['**/*.{js,css,html,ico,png,svg,cube,json,txt}'],
          // Social image is never read by the app; manifest icons are already
          // injected by the plugin, so the glob must not list them again.
          globIgnores: ['social-preview.png', 'pwa-192x192.png', 'pwa-512x512.png', 'pwa-512x512-maskable.png'],
          navigateFallback: 'index.html',
          ...(isBeta
            ? { cacheId: 'film-studio-beta', navigateFallbackAllowlist: [/^\/AGPilot0007\/beta(?:\/|$)/] }
            : { navigateFallbackDenylist: [/^\/AGPilot0007\/beta(?:\/|$)/] }),
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
      // Wall-clock perf assertions cannot be deterministic next to parallel
      // workers; they run serially via vitest.perf.config.ts (`npm run test:perf`).
      exclude: ['node_modules', 'dist', 'tests/e2e/**', 'tests/q04Perf.test.ts', '**/.private/**'],
    },
  };
});
