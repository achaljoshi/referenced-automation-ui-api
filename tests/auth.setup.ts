import * as fs from 'node:fs';
import * as path from 'node:path';
import { ApiClient } from '@automation/referenced-automation-api';
import { test as setup } from '@automation/referenced-automation-ui';
import { AUTH_FILE } from './support/authState';
import { startAuthServer, stopAuthServer } from './support/authServer';

/**
 * Log in ONCE, by API, and save the browser state; every other test then
 * starts already logged in (see `auth` in playwright.config.ts) instead of
 * clicking through a login form each time. Faster, and a login-page change
 * can't break the whole suite.
 *
 * Here the login is an API call - the same shape as logging in to a real
 * system's token endpoint - and `context.request` shares its cookie jar with
 * the browser context, so saving the context's state saves the session.
 */
setup('log in via the API and save the session', async ({ context }) => {
  const server = await startAuthServer();
  try {
    const api = new ApiClient(context.request, server.baseUrl);
    (await api.post('/login', { json: { username: 'ada', password: 'secret' } })).expectStatus(200);
    fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
    await context.storageState({ path: AUTH_FILE });
  } finally {
    await stopAuthServer(server);
  }
});
