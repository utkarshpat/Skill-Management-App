// A root entrypoint prevents framework detection from treating src/app.ts
// (the dependency-injected app factory) as the configured running application.
import express from 'express';
import configuredApp from './src/server.js';

const app: ReturnType<typeof express> = configuredApp;
export default app;
