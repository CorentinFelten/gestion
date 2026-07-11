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
        // Split the heavy charting library into its own chunk so it can be
        // loaded on demand by the lazy chart pages rather than up front.
        manualChunks: {
          recharts: ['recharts'],
        },
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
