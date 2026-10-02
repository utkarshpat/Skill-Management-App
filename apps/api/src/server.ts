import { createApp } from './app.js';
import { identityConfig, tokenVerifier } from './auth.js';
import { ownProfile } from './profile.js';
import { closeRuntimeDatabase } from './database.js';
import { developmentLoginEnabled } from './development-login.js';
import { LocalAccessStore } from './local-access-store.js';
import { fileURLToPath } from 'node:url';

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const config = identityConfig(process.env);
const developmentStore = developmentLoginEnabled(process.env) ? await LocalAccessStore.open(fileURLToPath(new URL('../.local/dev-access.json',import.meta.url))) : undefined;
const server = createApp(config ? { verify: tokenVerifier(config), profile: ownProfile } : undefined, { developmentStore }).listen(port, '127.0.0.1', () => {
  console.log(`Capability API: http://127.0.0.1:${port}`);
});
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => server.close(() => { closeRuntimeDatabase().then(() => process.exit(0)).catch(() => process.exit(1)); }));
}
