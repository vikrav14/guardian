import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const opsProxy = {
  '/ops': {
    target: 'http://127.0.0.1:9001',
    changeOrigin: true,
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: opsProxy,
  },
  preview: {
    port: 5173,
    proxy: opsProxy,
  },
});
