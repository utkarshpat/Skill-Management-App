import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@azure/msal-browser')) return 'vendor-msal';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (
            id.includes('/react/') ||
            id.includes('\\react\\') ||
            id.includes('/react-dom/') ||
            id.includes('\\react-dom\\') ||
            id.includes('/react-router/') ||
            id.includes('\\react-router\\') ||
            id.includes('/scheduler/') ||
            id.includes('\\scheduler\\')
          ) {
            return 'vendor-react';
          }
          return undefined;
        },
      },
    },
  },
  // Vercel Services routes /api before the request enters Vite. Only standalone
  // npm run dev needs the loopback proxy; no runtime binding is used in a build.
  server: {
    port: 5173,
    strictPort: true,
    proxy: process.env.VERCEL === '1' ? undefined : { '/api': 'http://127.0.0.1:3001' },
  },
});
