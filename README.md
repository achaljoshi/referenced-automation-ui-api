# referenced-automation-ui-api

Composes [`referenced-automation-ui`](../referenced-automation-ui), [`referenced-automation-api`](../referenced-automation-api), and [`referenced-automation-utils`](../referenced-automation-utils) as plain npm dependencies - **zero duplicated framework code**. This repo's only original content is glue: a tiny sample server, a page object, and specs proving both frameworks work together in one test - including sharing session state between an API-driven step and a UI step, with no manual token copy-pasting.

## Why this repo is almost entirely glue

Both dependencies are complete on their own (`BasePage` for UI, `ApiClient` for API). Neither needs anything from this repo to work - what only exists here is the proof that combining them is straightforward, plus the pattern for doing it correctly.

## Sharing a session between an API step and a UI step

Playwright's `BrowserContext.request` is an `APIRequestContext` that **shares its cookie jar with the browser context it belongs to**. So instead of logging in via the API and manually copying a token/cookie into the browser, you construct the API client on top of the browser context's own request context:

```ts
test('an API-issued session cookie is honoured by the UI', async ({ page, context }) => {
  const apiClient = new ApiClient(context.request, baseUrl); // <- shares context's cookies

  const loginResponse = await apiClient.post('/login', { json: { username, password } });
  loginResponse.expectStatus(200);

  await page.goto(`${baseUrl}/dashboard.html`); // the cookie the login just set is already there
  // ... assert the UI reflects the logged-in state
});
```

No `document.cookie` scripting, no `context.addCookies()` bookkeeping - the session genuinely is one session, not two synchronised ones. See `tests/hybridSession.spec.ts` for the full working example (including the negative cases: no login → anonymous state, failed login → no session granted).

## Quick start

```bash
./scripts/setup.sh      # npm ci + playwright install --with-deps (scripts/setup.bat on Windows)
npm test
```

## Using this pattern in your own project

```jsonc
// package.json
"dependencies": {
  "@automation/referenced-automation-ui": "file:../shared-packages/referenced-automation-ui-1.0.0.tgz",
  "@automation/referenced-automation-api": "file:../shared-packages/referenced-automation-api-1.0.0.tgz",
  "@automation/referenced-automation-utils": "file:../shared-packages/referenced-automation-utils-1.0.0.tgz"
}
```

Then write page objects on `BasePage` and API calls on `ApiClient` exactly as documented in each of those repos' READMEs - this repo adds nothing to their APIs, it only demonstrates using both at once.

## Environments

Same `.env.<name>` + `ENV=<name>` pattern as the rest of this family (see `referenced-automation-utils`'s README). This repo's own tests spin up an in-process server and don't read `BASE_URL`/`API_BASE_URL` themselves - they're here as the template a real hybrid project's env files follow.

## IDE setup

Same as the other repos in this family: VS Code prompts for recommended extensions on open; IntelliJ/WebStorm ships ESLint/Prettier wired in plus an `npm: test` run configuration.
