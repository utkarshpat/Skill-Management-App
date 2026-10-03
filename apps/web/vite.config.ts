import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Vercel Services routes /api before the request enters Vite. Only standalone
  // npm run dev needs the loopback proxy; no runtime binding is used in a build.
  server: { port: 5173, strictPort: true, proxy: process.env.VERCEL === '1' ? undefined : { '/api': 'http://127.0.0.1:3001' } },
});
