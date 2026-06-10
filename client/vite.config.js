import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify(
      process.env.VITE_API_URL ||
      (process.env.RAILWAY_SERVICE_TECNOVEND_API_URL
        ? `https://${process.env.RAILWAY_SERVICE_TECNOVEND_API_URL}`
        : '')
    ),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/arduino': 'http://localhost:3000',
    },
  },
});
