import { test, expect, request as playwrightRequest } from '@playwright/test';
import { ApiClient, MockServer, mockApiRoute, registerApiSteps } from '@automation/referenced-automation-api';

/**
 * A thin import check, not a re-test of the API package: it has its own suite (every HTTP method, auth providers,
 * pagination, XML, recording and playback ...). All this repo needs to know is that what IT composes - `ApiClient` on a
 * Playwright request context, `MockServer`, `mockApiRoute`, the Gherkin steps - resolves from the installed package and
 * makes one real round trip. Deliberately not tagged @smoke. (`mockApiRoute` in a UI test is demoed in
 * features/mocked-profile.feature; the hybrid session in features/hybrid-login.feature.)
 */
test.describe('api: what this repo builds on', () => {
  test('ApiClient talks to a MockServer over a real request; the steps and route mocking are exported', async () => {
    expect(typeof mockApiRoute).toBe('function');
    expect(typeof registerApiSteps).toBe('function');
    const server = new MockServer();
    await server.start();
    const context = await playwrightRequest.newContext();
    try {
      server.get('/ping', () => ({ pong: true }));
      const response = await new ApiClient(context, server.baseUrl).get('/ping');
      response.expectStatus(200);
      expect(response.get('pong')).toBe(true);
    } finally {
      await context.dispose();
      await server.stop();
    }
  });
});
