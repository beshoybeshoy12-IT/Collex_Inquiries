import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Port 5174 and API 5100, both offset from Collex System V1 (5173 / 5000) so
 * the two products can run on one machine at the same time.
 *
 * The proxy STRIPS NOTHING: the API is mounted at `/api/v1` and the client
 * calls `/api/v1/...`, so what the browser sends is what Nest routes. Collex
 * System V1's proxy rewrites `/api` away, which means its client URLs and its
 * controller paths never match and every new route is a guess about which side
 * owns the prefix.
 */
export default defineConfig({
  plugins: [react()],

  server: {
    port: 5174,
    strictPort: false,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5100',
        changeOrigin: true,
      },
      '/realtime': {
        target: 'http://127.0.0.1:5100',
        ws: true,
        changeOrigin: true,
      },
    },
  },

  build: {
    // Every vendor library reachable from more than one route would otherwise
    // be duplicated into each route chunk, or hoisted into the entry. Naming
    // the big ones means the browser caches them once and an app-code deploy
    // does not invalidate them.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          const path = id.split('\\').join('/');

          const groups = [
            ['vendor-react', ['/react/', '/react-dom/', '/react-router', '/scheduler/']],
            ['vendor-query', ['/@tanstack/']],
            ['vendor-charts', ['/chart.js/', '/react-chartjs-2/']],
            ['vendor-forms', ['/react-hook-form/', '/@hookform/', '/zod/']],
            ['vendor-i18n', ['/i18next/', '/react-i18next/']],
            ['vendor-socket', ['/socket.io-client/', '/engine.io-client/']],
          ];

          const hit = groups.find(([, needles]) =>
            needles.some((needle) => path.includes(needle)),
          );
          return hit ? hit[0] : undefined;
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
});
