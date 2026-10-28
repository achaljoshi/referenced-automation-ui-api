/// <reference lib="dom" />
import * as fs from 'node:fs';
import { mockApiRoute } from '@automation/referenced-automation-api';
import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';
import { AUTH_FILE } from '../../tests/support/authState';
import { test } from './fixtures';

const { Given, When, Then } = createBdd(test);

// Steps for who is signed in to the sample web app, what its server made of the session cookie, and what its profile page
// shows. The sentences about the page and the API (open the page, send a request, the response status ...) are the shared
// ones in steps.ts.

const cookieValue = async (context: { cookies(): Promise<Array<{ name: string; value: string }>> }) => (await context.cookies()).find((c) => c.name === 'session')?.value;

Given('I start already logged in with the login saved by the setup project', async ({ context }) => {
  // What `storageState` does for a browser project: the cookies tests/auth.setup.ts saved. No login step of the scenario's own.
  if (!fs.existsSync(AUTH_FILE)) throw new Error(`No saved login at ${AUTH_FILE}: the "setup" project (tests/auth.setup.ts) creates it and the bdd project depends on it`);
  const state = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')) as { cookies: Parameters<typeof context.addCookies>[0]; origins?: unknown[] };
  if ((state.origins ?? []).length > 0) throw new Error('The saved login holds local storage as well as cookies; this step restores cookies only');
  await context.addCookies(state.cookies);
});

Given('another sample server whose sessions last {int} seconds', async ({ sessions, vars }, seconds: number) => {
  vars.set('otherServer', (await sessions.startServerWithClock(seconds)).baseUrl);
});

Given('another sample server that never issued the saved login', async ({ sessions, vars }) => {
  // The same saved login replayed against a server with a different key: the session is not one it knows.
  vars.set('otherServer', (await sessions.startServer({ signingKey: 'a-server-that-never-issued-this-session' })).baseUrl);
});

Given('the browser carries a session cookie forged as {string}', async ({ sessions, context }, how: string) => {
  await context.addCookies([{ name: 'session', value: sessions.forgedSession(how), url: sessions.server.baseUrl }]);
});

Given('I log in as {string} with the password {string} over an API connection that does not share the browser\'s cookies', async ({ sessions, vars }, username: string, password: string) => {
  // A request context with its OWN cookie jar - not the browser context's - so the cookie never reaches the browser.
  const { api } = await sessions.detachedApi();
  (await api.post('/login', { json: { username: vars.interpolate(username), password: vars.interpolate(password) } })).expectStatus(200);
});

Given('the profile API is mocked, with mockApiRoute, to answer the name {string}', async ({ page, vars }, name: string) => {
  // `mockApiRoute` of the API package, used in a UI scenario: the page's own fetch of /api/profile gets the mock, and the real endpoint is untouched.
  await mockApiRoute(page, { url: '**/api/profile', method: 'GET', body: { name: vars.interpolate(name) } });
});

When("the server's clock moves on by {int} seconds", ({ sessions }, seconds: number) => {
  // The server's clock passes the session's expiry; the browser still holds the cookie.
  sessions.moveClock(seconds);
});

When("I remember the browser's session cookie as {string}", async ({ context, vars }, name: string) => {
  vars.set(name, (await cookieValue(context)) ?? '');
});

Then('that API connection is signed in', async ({ sessions }) => {
  const { context } = await sessions.detachedApi();
  expect((await context.get(`${sessions.server.baseUrl}/api/profile`)).status()).toBe(200);
});

Then('the browser holds no session cookie', async ({ context }) => {
  expect(await cookieValue(context)).toBeUndefined();
});

Then('the server recognised the session on the dashboard as {string}', ({ sessions }, state: string) => {
  // the SERVER decided that, from the cookie the browser sent - not a script reading document.cookie
  expect(sessions.lastDashboardSession()).toBe(state);
});

Then('the profile name reads {string}', async ({ page, vars }, name: string) => {
  await expect(page.locator('#profile-name')).toHaveText(vars.interpolate(name));
});

Then('the page cannot read the session cookie', async ({ page }) => {
  expect(await page.evaluate(() => document.cookie)).not.toContain('session=');
});

Then('the session cookie is HttpOnly', async ({ context }) => {
  expect((await context.cookies()).find((c) => c.name === 'session')?.httpOnly).toBe(true);
});

Then('the variable {string} does not contain {string}', ({ vars }, name: string, text: string) => {
  expect(vars.require(name)).not.toContain(vars.interpolate(text));
});

Then('the variable {string} is different from the variable {string}', ({ vars }, name: string, other: string) => {
  expect(vars.require(name)).not.toBe(vars.require(other));
});
