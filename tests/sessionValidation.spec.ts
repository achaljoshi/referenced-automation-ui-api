/// <reference lib="dom" />
import { test, expect } from '@automation/referenced-automation-ui';
import { ApiClient } from '@automation/referenced-automation-api';
import { request as playwrightRequest } from '@playwright/test';
import { startAuthServer, stopAuthServer, type AuthServerHandle } from './support/authServer';
import { ANONYMOUS } from './support/authState';
import { createDashboardPage } from './support/DashboardPage';

// The session checks of the sample server, from the outside: what a forged, an expired and a missing cookie get, and that
// a login really issues a different session each time. Each of these passed on the old server (which showed the welcome
// banner for ANY `session=` cookie) - they exist so the hybrid-session tests can fail for the right reason.
test.use({ storageState: ANONYMOUS });

const credentials = { username: 'ada', password: 'secret' };
const cookieValue = async (context: { cookies(): Promise<Array<{ name: string; value: string }>> }) => (await context.cookies()).find((c) => c.name === 'session')?.value;

let server: AuthServerHandle;
test.beforeAll(async () => {
  server = await startAuthServer();
});
test.afterAll(async () => {
  await stopAuthServer(server);
});

test.describe('the server decides who is signed in', () => {
  test('a forged cookie is anonymous on the page and 401 on the API, however it is forged @regression', async ({ page, context }) => {
    const real = server.issueSession('ada');
    const [payload] = real.split('.');
    const admin = Buffer.from(JSON.stringify({ sid: 'x', user: 'admin', exp: Date.now() + 3_600_000 })).toString('base64url');
    const forgeries = {
      'the constant the old server handed out': 'issued-by-api',
      'a valid payload with someone else\'s signature': `${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`,
      'a different user under the real signature': `${admin}.${real.split('.')[1]}`,
      'an unsigned payload': payload as string,
    };
    const dashboard = createDashboardPage(page);
    for (const [how, value] of Object.entries(forgeries)) {
      await context.clearCookies();
      await context.addCookies([{ name: 'session', value, url: server.baseUrl }]);
      await dashboard.goto(`${server.baseUrl}/dashboard.html`);
      await dashboard.expectAnonymous();
      await dashboard.expectNoWelcome();
      expect(server.seen.filter((r) => r.path === '/dashboard.html').pop()?.session, how).toBe('forged');
      const profile = await context.request.get(`${server.baseUrl}/api/profile`);
      expect(profile.status(), how).toBe(401);
    }
  });

  test('an expired session is anonymous on the page and 401 on the API - the same cookie was fine before it expired @regression', async ({ page, context }) => {
    let clock = Date.now();
    const timed = await startAuthServer({ now: () => clock, sessionSeconds: 60 });
    try {
      const api = new ApiClient(context.request, timed.baseUrl);
      (await api.post('/login', { json: credentials })).expectStatus(200);
      const dashboard = createDashboardPage(page);

      await dashboard.goto(`${timed.baseUrl}/dashboard.html`);
      await dashboard.expectWelcome();
      expect((await context.request.get(`${timed.baseUrl}/api/profile`)).status()).toBe(200);

      clock += 61_000; // the server's clock passes the session's expiry; the browser still holds the cookie
      await dashboard.goto(`${timed.baseUrl}/dashboard.html`);
      await dashboard.expectAnonymous();
      await dashboard.expectNoWelcome();
      expect(timed.seen.filter((r) => r.path === '/dashboard.html').pop()?.session).toBe('expired');
      const profile = await context.request.get(`${timed.baseUrl}/api/profile`);
      expect(profile.status()).toBe(401);
      expect((await profile.json()).session).toBe('expired');
    } finally {
      await stopAuthServer(timed);
    }
  });

  test('a login the BROWSER never received does not sign the page in: the UI step must actually send the cookie @regression', async ({ page, context }) => {
    // Logged in through a request context with its OWN cookie jar - not context.request - so the cookie never reaches the browser.
    const detached = await playwrightRequest.newContext();
    try {
      const api = new ApiClient(detached, server.baseUrl);
      (await api.post('/login', { json: credentials })).expectStatus(200);
      expect((await detached.get(`${server.baseUrl}/api/profile`)).status()).toBe(200); // the API side IS signed in
      expect(await cookieValue(context)).toBeUndefined(); // the browser is not

      const dashboard = createDashboardPage(page);
      await dashboard.goto(`${server.baseUrl}/dashboard.html`);
      await dashboard.expectAnonymous();
      await dashboard.expectNoWelcome();
      expect(server.seen.filter((r) => r.path === '/dashboard.html').pop()?.session).toBe('missing');
    } finally {
      await detached.dispose();
    }
  });

  test('every login issues a different, signed session @regression', async ({ context }) => {
    const api = new ApiClient(context.request, server.baseUrl);
    (await api.post('/login', { json: credentials })).expectStatus(200);
    const first = await cookieValue(context);
    (await api.post('/login', { json: credentials })).expectStatus(200);
    const second = await cookieValue(context);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    expect(first).toMatch(/^[\w-]+\.[\w-]+$/); // payload.signature, not a constant word
    expect(first).not.toContain('issued-by-api');
  });

  test('the session cookie cannot be read by the page (HttpOnly), so the page cannot be "signed in" by a script @regression', async ({ page, context }) => {
    (await new ApiClient(context.request, server.baseUrl).post('/login', { json: credentials })).expectStatus(200);
    await createDashboardPage(page).goto(`${server.baseUrl}/dashboard.html`);
    expect(await page.evaluate(() => document.cookie)).not.toContain('session=');
    expect((await context.cookies()).find((c) => c.name === 'session')?.httpOnly).toBe(true);
  });
});
