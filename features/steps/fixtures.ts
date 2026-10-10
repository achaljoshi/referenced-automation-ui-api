import { ApiClient, test as apiTest } from '@automation/referenced-automation-api';
import { createSampleSapSystem, sapGuiTest } from '@automation/referenced-automation-sap';
import { mergeTests } from '@playwright/test';
import { test as bddTest } from 'playwright-bdd';
import { startAuthServer, stopAuthServer, type AuthServerHandle } from '../../tests/support/authServer';
import { OrderLandscape } from '../../tests/support/orderLandscape';

// The simulator's own made-up credentials (not real; never commit real ones - use .env.<name>.local or CI variables).
process.env.SAP_USER ??= 'TESTUSER';
process.env.SAP_PASSWORD ??= 'correct-horse';
process.env.SAP_CLIENT ??= '100';

/**
 * The ONE test every feature in this repo runs in. It merges the three packages' tests - SAP (`sap`, evidence, cleanup),
 * UI (`page`, scenario banner, page guard ...) and API (`apiClient`, `cleanup`, failure evidence ...) - so a single
 * scenario can mix steps from all of them, and they share one `vars` (a value remembered from SAP is `{{order}}` to the
 * API step that follows).
 *
 * The sample landscape is in-process so the features run anywhere: SAP is the built-in simulator, the web app is
 * tests/support/authServer.ts, and the systems around SAP are tests/support/orderLandscape.ts. For a real landscape
 * delete these overrides, set SAP_GUI_MODE / BASE_URL / API_BASE_URL in the .env files, and the same features run
 * against the real systems.
 */
// playwright-bdd needs its own `test` underneath; mergeTests combines it with the three packages' tests.
export const test = mergeTests(bddTest, sapGuiTest, apiTest).extend<{ landscape: OrderLandscape }, { authServer: AuthServerHandle }>({
  sapGuiTransport: [
    async ({}, use) => {
      await use(() => createSampleSapSystem({ transitionDelayMs: 20 }));
    },
    { scope: 'worker' },
  ],

  authServer: [
    async ({}, use) => {
      const server = await startAuthServer();
      await use(server);
      await stopAuthServer(server);
    },
    { scope: 'worker' },
  ],

  // The web app is the sample server, so `I open the page "/dashboard.html"` works.
  baseURL: async ({ authServer }, use) => {
    await use(authServer.baseUrl);
  },

  // Built on the browser context's own request context: its cookie jar IS the browser's, so logging in through the
  // API signs the browser in too - no token copied between the two.
  apiClient: async ({ authServer, context }, use) => {
    await use(new ApiClient(context.request, authServer.baseUrl));
  },

  // Started by "Given the order landscape is running" (a fixture is only created when a step asks for it).
  landscape: async ({}, use) => {
    const landscape = await OrderLandscape.start();
    await use(landscape);
    await landscape.stop();
  },
});
