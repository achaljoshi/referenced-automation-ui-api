import { test, expect } from '@automation/referenced-automation-ui';
import { ApiClient } from '@automation/referenced-automation-api';
import { startAuthServer, stopAuthServer, type AuthServerHandle } from './support/authServer';
import { ANONYMOUS } from './support/authState';
import { createDashboardPage } from './support/DashboardPage';

// These tests are about the live API -> UI cookie sharing and the anonymous
// state, so they must NOT start from the suite's saved login (see
// tests/storageState.spec.ts for the opposite).
test.use({ storageState: ANONYMOUS });

let server: AuthServerHandle;

test.beforeAll(async () => {
  server = await startAuthServer();
});

test.afterAll(async () => {
  await stopAuthServer(server);
});

test.describe('hybrid identity - one login, two frameworks', () => {
  test('an API-issued session cookie is honoured by the UI @smoke', async ({ page, context }) => {
    // context.request shares its cookie jar with the browser context it
    // belongs to - this IS the session sharing, not a manual token copy.
    const apiClient = new ApiClient(context.request, server.baseUrl);

    const loginResponse = await apiClient.post('/login', {
      json: { username: 'ada', password: 'secret' },
    });
    loginResponse.expectStatus(200).expectValue('user', 'ada');

    const dashboard = createDashboardPage(page);
    await dashboard.goto(`${server.baseUrl}/dashboard.html`);
    await dashboard.expectWelcome();
    await dashboard.expectNoAnonymous();
    // the SERVER decided that, from the cookie the browser sent - not a script reading document.cookie
    expect(server.seen.filter((r) => r.path === '/dashboard.html').pop()?.session).toBe('valid');
  });

  test('without logging in via the API, the UI shows the anonymous state @regression', async ({
    page,
  }) => {
    const dashboard = createDashboardPage(page);
    await dashboard.goto(`${server.baseUrl}/dashboard.html`);
    await dashboard.expectAnonymous();
    await dashboard.expectNoWelcome();
  });

  test('a failed API login does not grant a UI session @regression', async ({ page, context }) => {
    const apiClient = new ApiClient(context.request, server.baseUrl);
    const loginResponse = await apiClient.post('/login', {
      json: { username: 'ada', password: 'wrong-password' },
    });
    expect(loginResponse.status()).toBe(401);

    const dashboard = createDashboardPage(page);
    await dashboard.goto(`${server.baseUrl}/dashboard.html`);
    await dashboard.expectAnonymous();
    await dashboard.expectNoWelcome();
  });
});
