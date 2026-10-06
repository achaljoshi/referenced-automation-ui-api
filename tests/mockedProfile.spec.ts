import { test, expect } from '@automation/referenced-automation-ui';
import { mockApiRoute } from '@automation/referenced-automation-api';
import { startAuthServer, stopAuthServer, type AuthServerHandle } from './support/authServer';

let server: AuthServerHandle;

test.beforeAll(async () => {
  server = await startAuthServer();
});

test.afterAll(async () => {
  await stopAuthServer(server);
});

test.describe('mocking runtime API data in a UI test', () => {
  test('without a mock, the page renders whatever the real API returns @smoke', async ({ page }) => {
    await page.goto(`${server.baseUrl}/profile.html`);
    await expect(page.locator('#profile-name')).toHaveText('Ada Lovelace');
  });

  test('mockApiRoute overrides the same fetch call with mock data instead @smoke', async ({ page }) => {
    // This is `@automation/referenced-automation-api`'s mockApiRoute, built
    // on Playwright's own page.route() - imported here into a UI test to
    // mock the runtime data profile.html fetches, no change to the real
    // /api/profile endpoint required.
    await mockApiRoute(page, {
      url: '**/api/profile',
      method: 'GET',
      body: { name: 'Mocked Ada' },
    });

    await page.goto(`${server.baseUrl}/profile.html`);
    await expect(page.locator('#profile-name')).toHaveText('Mocked Ada');
  });
});
