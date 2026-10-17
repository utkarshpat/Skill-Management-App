import express, { type Express } from 'express';
import { accessSync, constants, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

/** Opt-in same-origin hosting. Only the compiled public web directory is served. */
export function registerWebHosting(app: Express, directory: string) {
  const root = resolve(directory);
  const index = join(root, 'index.html');
  accessSync(index, constants.R_OK);
  if (!statSync(index).isFile()) throw new Error('Built web index is unavailable.');

  app.use(
    express.static(root, {
      index: false,
      redirect: false,
      dotfiles: 'deny',
      setHeaders(res, file) {
        // Only content-hashed Vite assets can safely outlive a deployment.
        res.setHeader(
          'Cache-Control',
          /[\\/]assets[\\/].+-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(file)
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        );
      },
    }),
  );
  app.use((req, res, next) => {
    // Missing assets, hidden paths, API requests and writes must never become HTML.
    // /api is handled before this middleware in createApp.
    if (
      !['GET', 'HEAD'].includes(req.method) ||
      req.path.split('/').some(segment => segment.startsWith('.')) ||
      req.path.startsWith('/assets/') ||
      req.path.startsWith('/brand/') ||
      extname(req.path) ||
      !req.accepts('html')
    ) {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile('index.html', { root });
  });
}
