import { ApiClient, test as apiTest } from '@automation/referenced-automation-api';
import { createSampleSapSystem, sapGuiTest } from '@automation/referenced-automation-sap';
import { mergeTests } from '@playwright/test';
import { test as bddTest } from 'playwright-bdd';
import { startAuthServer, stopAuthServer, type AuthServerHandle } from '../../tests/support/authServer';
import { ANONYMOUS } from '../../tests/support/authState';
import { OrderLandscape } from '../../tests/support/orderLandscape';
import { Cleanups } from './support/cleanups';
import { OrderScenario } from './support/orders';
import { OwnRemoteHost, RemoteScenario, startStandInHost, stopStandInHost, type StandInHost } from './support/remote';
import { SessionScenario } from './support/sessions';

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
export const test = mergeTests(bddTest, sapGuiTest, apiTest).extend<
  { landscape: OrderLandscape; cleanups: Cleanups; sessions: SessionScenario; orders: OrderScenario; remote: RemoteScenario; ownRemoteHost: OwnRemoteHost },
  { authServer: AuthServerHandle; standInRemote: StandInHost }
>({
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

  // Every scenario starts with a clean browser: the `bdd` project has no saved login (a scenario that wants it says so with
  // "Given I start already logged in with the login saved by the setup project"), and this keeps it that way if a project ever adds one.
  storageState: async ({}, use) => {
    await use(ANONYMOUS);
  },

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

  // Whatever a step starts for one scenario only (another sample server, an API connection, an agent) is stopped after it.
  cleanups: async ({}, use) => {
    const cleanups = new Cleanups();
    await use(cleanups);
    await cleanups.run();
  },

  sessions: async ({ authServer, cleanups }, use) => {
    await use(new SessionScenario(authServer, cleanups));
  },

  orders: async ({}, use) => {
    await use(new OrderScenario());
  },

  // The stand-in remote host the "remote host" steps use (not `remoteHost`, which the API package's fixtures already own): one stand-in agent per worker, started the first time a scenario needs it.
  standInRemote: [
    async ({}, use) => {
      const host = await startStandInHost('ui-api-remote-');
      await use(host);
      await stopStandInHost(host);
    },
    { scope: 'worker' },
  ],

  remote: async ({ standInRemote, authServer }, use) => {
    await use(new RemoteScenario(standInRemote.host, authServer));
  },

  ownRemoteHost: async ({ cleanups }, use) => {
    await use(new OwnRemoteHost(cleanups));
  },
});
