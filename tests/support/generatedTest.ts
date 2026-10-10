import { test as apiTest, ApiClient } from '@automation/referenced-automation-api';
import { test as uiTest } from '@automation/referenced-automation-ui';
import { mergeTests } from '@playwright/test';
import { startAuthServer, stopAuthServer, type AuthServerHandle } from './authServer';
import { ANONYMOUS } from './authState';

// The made-up login the sample server accepts. Real projects set API_PASSWORD from .env.<ENV>.local or a CI variable.
process.env.API_PASSWORD ??= 'secret';

/**
 * The base test for the tests converted from recordings/ and curl/: the UI and API frameworks' tests merged, with the
 * recorded site and the curl'd API both answered by the sample server, so the converted tests run offline. In a real
 * project you do not need this file: BASE_URL / API_BASE_URL point at the real systems.
 */
export const test = mergeTests(uiTest, apiTest).extend<object, { sampleServer: AuthServerHandle }>({
  sampleServer: [
    async ({}, use) => {
      const server = await startAuthServer();
      await use(server);
      await stopAuthServer(server);
    },
    { scope: 'worker' },
  ],
  // The recording was made signed out; this suite's browser projects start from a saved login, so opt out of it.
  storageState: async ({}, use) => {
    await use(ANONYMOUS);
  },
  baseURL: async ({ sampleServer }, use) => {
    await use(sampleServer.baseUrl);
  },
  apiClient: async ({ sampleServer, request }, use) => {
    await use(new ApiClient(request, sampleServer.baseUrl));
  },
});

export { expect } from '@playwright/test';
