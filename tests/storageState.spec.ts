import { expect, test } from '@automation/referenced-automation-ui';
import { startAuthServer, stopAuthServer, type AuthServerHandle } from './support/authServer';
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
  // storageState every project loads (see playwright.config.ts).
  const dashboard = createDashboardPage(page);
  await dashboard.goto(`${server.baseUrl}/dashboard.html`);
  expect(await dashboard.isWelcomeShown()).toBe(true);
});
