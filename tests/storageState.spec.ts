import { expect, test } from '@automation/referenced-automation-ui';
import { startAuthServer, stopAuthServer, type AuthServerHandle } from './support/authServer';
import { AUTH_FILE } from './support/authState';
import { createDashboardPage } from './support/DashboardPage';

let server: AuthServerHandle;

test.beforeAll(async () => {
  server = await startAuthServer();
});

test.afterAll(async () => {
  await stopAuthServer(server);
});

test('a test starts already logged in, with no login step of its own @smoke', async ({ page }) => {
  // Nothing here logs in: the session came from tests/auth.setup.ts, via the
  // storageState every project loads (see playwright.config.ts). It was issued by a server that no longer exists; this
  // server recognises it because it checks the SIGNATURE (same key), not because it remembers issuing it.
  const dashboard = createDashboardPage(page);
  await dashboard.goto(`${server.baseUrl}/dashboard.html`);
  await dashboard.expectWelcome();
  expect(server.seen.filter((r) => r.path === '/dashboard.html').pop()?.session).toBe('valid');
});

test('the saved login is only as good as the server that checks it: a server that did not issue it shows the anonymous page @regression', async ({ browser }) => {
  // The same saved state, replayed against a server with a different key - the session is not one it knows.
  const stranger = await startAuthServer({ signingKey: 'a-server-that-never-issued-this-session' });
  const context = await browser.newContext({ storageState: AUTH_FILE });
  try {
    const dashboard = createDashboardPage(await context.newPage());
    await dashboard.goto(`${stranger.baseUrl}/dashboard.html`);
    await dashboard.expectAnonymous();
    await dashboard.expectNoWelcome();
    expect(stranger.seen.filter((r) => r.path === '/dashboard.html').pop()?.session).toBe('forged');
    expect((await context.request.get(`${stranger.baseUrl}/api/profile`)).status()).toBe(401);
  } finally {
    await context.close();
    await stopAuthServer(stranger);
  }
});
