import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  build: {
    rollupOptions: {
      input: { index: 'index.html', raw: 'raw.html', video: 'video.html' },
    },
  },
  server: {
    port: 5199,
    strictPort: true,
    fs: { allow: ['..'] },
  },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['flashraw', 'libraw-wasm'] },
});
