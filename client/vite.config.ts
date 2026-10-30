import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the Socket.IO traffic is proxied to the Node server (port 3000).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
