import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split the heavy charting stack (recharts + its d3/victory-vendor deps)
        // into its own chunk so it loads on demand with the lazy chart pages
        // rather than up front. (Vite 8 / Rollup 4 dropped the object form of
        // manualChunks; the function form below is equivalent.)
        manualChunks: (id) =>
          /node_modules\/(recharts|victory-vendor|d3-|internmap)/.test(id)
            ? 'recharts'
            : undefined,
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    // Dev-only proxy so the SPA can call /api/v1 against the local backend.
    // In production Caddy handles this routing.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
