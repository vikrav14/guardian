import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/ops': {
        target: 'http://localhost:9001',
        changeOrigin: true,
      },
    },
  },
});
