// Keep this deployment entrypoint distinct from the dependency-injected factory.
import express from 'express';
import configuredApp from './src/server.js';

const app: ReturnType<typeof express> = configuredApp;
export default app;
