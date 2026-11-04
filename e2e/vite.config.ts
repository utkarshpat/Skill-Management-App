import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import base from '../apps/web/vite.config.ts';
export default mergeConfig(
  base,
  defineConfig({
    resolve: {
      alias: {
        '@azure/msal-browser': fileURLToPath(new URL('./msal-fixture.ts', import.meta.url)),
      },
    },
    server: { proxy: {}, host: '127.0.0.1', port: 4179, strictPort: true },
  }),
);
