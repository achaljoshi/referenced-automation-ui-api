import { test, expect } from '@automation/referenced-automation-ui';
import { byControlId, waitForUI5Ready } from '@automation/referenced-automation-sap';
import { actions } from '@automation/referenced-automation-ui';
import { startAuthServer, stopAuthServer, type AuthServerHandle } from './support/authServer';

let server: AuthServerHandle;

test.beforeAll(async () => {
  server = await startAuthServer();
});

test.afterAll(async () => {
  await stopAuthServer(server);
});

test.describe('referenced-automation-sap helpers imported into this hybrid repo @smoke', () => {
  test('byControlId matches on the logical id suffix, ignoring the UI5-generated prefix', async ({ page }) => {
    await actions.goto(page, `${server.baseUrl}/fiori-style.html`);

    const button = byControlId(page, 'addToCartBtn');
    await expect(button).toBeVisible();
    expect(await button.getAttribute('id')).toBe('__component0---mainView--addToCartBtn');
  });

  test('waitForUI5Ready waits out a transient busy indicator', async ({ page }) => {
    await actions.goto(page, `${server.baseUrl}/fiori-style.html`);

    await actions.click(byControlId(page, 'addToCartBtn'));
    await waitForUI5Ready(page);

    await expect(page.locator('#busy-overlay')).toBeHidden();
  });
});
